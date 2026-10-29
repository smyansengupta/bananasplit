import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { PLAN_NAMES } from "@/lib/billing/features";
import { spaceLimits } from "@/lib/billing/space";
import {
  crossesWarning,
  formatStorage,
  formatUsed,
  fullRefusal,
  STORAGE_WARNING_RATIO,
  storageState,
  uploadRefusal,
  type StorageSpace,
  type StorageState,
  type UploadCheckOptions,
  type UploadRefusal,
} from "@/lib/billing/storage";
import type { Role } from "@/generated/prisma/enums";
import { withOrgTx, type TxClient } from "@/server/db/context";
import { notifyUsers, type NotifyDb } from "@/server/notifications";

/**
 * The upload gate (redesign guide 11.2), for every path that stores bytes
 * that count (Notes files and images in notes, receipts, direct uploads):
 *
 *   1. checkUpload(orgId, size, { feature })  before the body is read or a
 *      byte is stored: the space includes the feature and isn't paused
 *      (spaceRefusal, the gate withOrgAction uses), the file is within the
 *      plan's largest file, and used + size fits the plan's storage.
 *   2. the blob is written (never inside a transaction).
 *   3. in the row's own transaction, after the INSERT: confirmFits(), which
 *      reads Organization.storageUsedBytes again. The database's trigger has
 *      just added the row's bytes, holding the org row's lock until commit,
 *      so two uploads racing for the last gigabyte can't both get in: the
 *      loser's transaction rolls back (UploadRefusedError) and its blob is
 *      deleted. The same read tells whether this upload crossed 80%, and
 *      warnStorage() tells the owners and admins (or the Personal owner)
 *      once: an in-app notification and its email, in the same transaction.
 *
 * Nothing is ever deleted for being over a limit.
 */

/** An upload the gate refused; routes answer with uploadRefusalResponse(error.refusal). */
export class UploadRefusedError extends Error {
  readonly refusal: UploadRefusal;
  constructor(refusal: UploadRefusal) {
    super(refusal.error);
    this.name = "UploadRefusedError";
    this.refusal = refusal;
  }
}

/** The JSON 4xx for a refused upload: the sentence, a code, and the numbers. */
export function uploadRefusalResponse(refusal: UploadRefusal): Response {
  return Response.json(
    {
      error: refusal.error,
      code: refusal.code,
      sizeBytes: refusal.sizeBytes,
      usedBytes: refusal.usedBytes,
      limitBytes: refusal.limitBytes,
      maxFileBytes: refusal.maxFileBytes,
    },
    { status: refusal.status, headers: { "Cache-Control": "no-store" } },
  );
}

export interface StorageRow extends StorageSpace {
  id: string;
  slug: string;
  name: string;
}

/** The org's plan columns and counter, read in `db`'s transaction. */
export async function readStorageSpace(db: TxClient, orgId: string): Promise<StorageRow | null> {
  return db.organization.findUnique({
    where: { id: orgId },
    select: {
      id: true,
      slug: true,
      name: true,
      kind: true,
      plan: true,
      trialEndsAt: true,
      planAfterTrial: true,
      storageUsedBytes: true,
    },
  });
}

/** The space's storage in use, in bytes (Organization.storageUsedBytes), for the session user. */
export async function readStorageUsed(orgId: string): Promise<number> {
  const row = await withOrgTx(orgId, ({ db }) =>
    db.organization.findUnique({ where: { id: orgId }, select: { storageUsedBytes: true } }),
  );
  return Number(row?.storageUsedBytes ?? 0);
}

/** Who may change the plan or empty the trash: owners and admins (the Personal owner is OWNER). */
export function canManageStorage(role: Role | null): boolean {
  return can({ role }, "settings.view");
}

export interface UploadGate {
  /** null: the upload may start. */
  refusal: UploadRefusal | null;
  space: StorageRow;
  state: StorageState;
  canManagePlan: boolean;
}

/**
 * Step 1: may the session user start an upload of `sizeBytes` to `orgId`?
 * `refusal` is null when they may; otherwise the 4xx (with the numbers).
 * Pass 0 before the size is known (the space and its feature only), then
 * the real size. Throws NotFoundError for a non-member, as every org route
 * does.
 */
export async function gateUpload(
  orgId: string,
  sizeBytes: number,
  options: Omit<UploadCheckOptions, "canManagePlan">,
): Promise<UploadGate> {
  return withOrgTx(orgId, async ({ db, role }) => {
    const space = await readStorageSpace(db, orgId);
    if (!space) throw new NotFoundError();
    const canManagePlan = canManageStorage(role);
    return {
      refusal: uploadRefusal(space, sizeBytes, { ...options, canManagePlan }),
      space,
      state: storageState(space),
      canManagePlan,
    };
  });
}

/** gateUpload() for its refusal alone: null when the upload may start. */
export async function checkUpload(
  orgId: string,
  sizeBytes: number,
  options: Omit<UploadCheckOptions, "canManagePlan">,
): Promise<UploadRefusal | null> {
  return (await gateUpload(orgId, sizeBytes, options)).refusal;
}

export interface FitResult {
  space: StorageRow;
  /** Bytes in use before this row and after it. */
  before: number;
  after: number;
}

/**
 * Step 3, in the row's transaction right after its INSERT: throws
 * UploadRefusedError (rolling the row back) when the space is now over its
 * storage, else returns the counter before and after, for warnStorage().
 */
export async function confirmFits(
  db: TxClient,
  orgId: string,
  sizeBytes: number,
  role: Role | null,
): Promise<FitResult> {
  const space = await readStorageSpace(db, orgId);
  if (!space) throw new Error("confirmFits: the org is gone");
  const after = Number(space.storageUsedBytes);
  const before = Math.max(0, after - sizeBytes);
  const { limitBytes } = storageState(space);
  if (after > limitBytes) {
    throw new UploadRefusedError(
      fullRefusal({ ...space, storageUsedBytes: before }, sizeBytes, canManageStorage(role)),
    );
  }
  return { space, before, after };
}

/** Where the storage page is. */
export function storagePageHref(slug: string): string {
  return `/app/${slug}/settings/plan/storage`;
}

/**
 * Whether a change took the space past 80% of its storage: an upload
 * (`before` → `after` bytes against the plan's limit), or a plan change
 * (the same bytes against a lower limit).
 */
export function crossedWarning(
  space: Pick<StorageRow, "kind" | "plan" | "trialEndsAt" | "planAfterTrial">,
  usage: { before: number; after: number } | { usedBytes: number; fromLimit: number },
): boolean {
  const limit = spaceLimits(space).storageBytes;
  if ("before" in usage) return crossesWarning(usage.before, usage.after, limit);
  return (
    usage.usedBytes < usage.fromLimit * STORAGE_WARNING_RATIO &&
    usage.usedBytes >= limit * STORAGE_WARNING_RATIO
  );
}

/**
 * Tells the owners and admins (a Personal space: its owner) that the space
 * passed 80% of its storage. Call it once per crossing (crossedWarning).
 * In-app, and by email through the notification's own job
 * (INTEGRATION_ERROR: the owners-and-admins notice; no new type).
 * `eventKey` names the crossing (the file's id, the plan change), so a
 * retried transaction can't notify twice.
 */
export async function warnStorage(
  db: NotifyDb & Pick<TxClient, "membership">,
  space: StorageRow,
  usedBytes: number,
  eventKey: string,
): Promise<boolean> {
  const limit = spaceLimits(space).storageBytes;
  const usage = { after: usedBytes };
  const recipients = await db.membership.findMany({
    where: { organizationId: space.id, role: { in: ["OWNER", "ADMIN"] } },
    select: { userId: true },
  });
  if (recipients.length === 0) return false;
  const personal = space.kind === "PERSONAL";
  const percent = Math.min(100, Math.floor((usage.after / limit) * 100));
  await notifyUsers(
    db,
    space.id,
    recipients.map((r) => r.userId),
    {
      type: "INTEGRATION_ERROR",
      title: personal
        ? `Your Personal space is using ${percent}% of its storage`
        : `${space.name} is using ${percent}% of its storage`,
      body: `${formatUsed(usage.after, limit)} of ${formatStorage(limit)} used on ${PLAN_NAMES[space.plan]}. Uploads stop at 100%; nothing is ever deleted. Empty the trash or change plan in Settings › Plan and storage.`,
      linkUrl: storagePageHref(space.slug),
      dedupeKey: `storage-${Math.round(STORAGE_WARNING_RATIO * 100)}:${eventKey}`,
    },
  );
  return true;
}
