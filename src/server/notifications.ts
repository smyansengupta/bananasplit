import { randomUUID } from "node:crypto";

import { Role, type NotificationType, type Prisma } from "@/generated/prisma/client";
import { enqueueJob } from "@/server/jobs/enqueue";

/**
 * In-app notifications plus their email copy, through the outbox (0B):
 *
 * - The Notification rows are written with createMany and app-generated ids
 *   (no RETURNING: the sender usually cannot SELECT another user's
 *   notification back under RLS).
 * - Each row gets a notify-email:{id} job in the SAME transaction, so a
 *   rolled-back write never emails anyone. The job checks the recipient's
 *   preference, routes through getOrgMailer and marks emailSentAt with a
 *   compare-and-set (src/server/email/jobs.ts).
 *
 * `db` is the caller's transaction client (ctx.db from withOrgAction or
 * withSystemOrgTx), or @/lib/prisma for legacy modules.
 */

export type NotifyDb = Pick<Prisma.TransactionClient, "notification" | "membership" | "$queryRaw">;

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Relative in-app link, e.g. /app/{slug}/tasks/{id}. */
  linkUrl?: string | null;
  taskId?: string | null;
  actorId?: string | null;
  /** Idempotency per recipient (e.g. mention:{taskId}:{sourceKey}); duplicates are skipped. */
  dedupeKey?: string | null;
}

function checkLink(linkUrl: string | null | undefined): string | null {
  if (!linkUrl) return null;
  if (!linkUrl.startsWith("/") || linkUrl.startsWith("//")) {
    throw new TypeError("notification links are relative app paths");
  }
  return linkUrl;
}

/** Notifies each of `userIds` (members of `organizationId`); returns the notification ids. */
export async function notifyUsers(
  db: NotifyDb,
  organizationId: string,
  userIds: readonly string[],
  input: NotifyInput,
): Promise<string[]> {
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return [];
  const linkUrl = checkLink(input.linkUrl);
  const rows = recipients.map((userId) => ({
    id: randomUUID(),
    organizationId,
    userId,
    type: input.type,
    title: input.title.slice(0, 300),
    body: input.body ? input.body.slice(0, 2000) : null,
    linkUrl,
    taskId: input.taskId ?? null,
    actorId: input.actorId ?? null,
    dedupeKey: input.dedupeKey ?? null,
  }));
  await db.notification.createMany({ data: rows, skipDuplicates: Boolean(input.dedupeKey) });
  for (const row of rows) {
    // A row skipped as a duplicate has no Notification: its job finds nothing and ends.
    await enqueueJob(db, {
      orgId: organizationId,
      kind: "notify-email",
      key: row.id,
      payload: { notificationId: row.id },
    });
  }
  return rows.map((r) => r.id);
}

/** Notifies one member. */
export async function notifyUser(
  db: NotifyDb,
  organizationId: string,
  userId: string,
  input: NotifyInput,
): Promise<string | null> {
  const [id] = await notifyUsers(db, organizationId, [userId], input);
  return id ?? null;
}

/** Notifies every OWNER of the org (security alerts, integration errors). */
export async function notifyOrgOwners(
  db: NotifyDb,
  organizationId: string,
  input: NotifyInput,
): Promise<string[]> {
  const owners = await db.membership.findMany({
    where: { organizationId, role: Role.OWNER },
    select: { userId: true },
  });
  return notifyUsers(
    db,
    organizationId,
    owners.map((o) => o.userId),
    input,
  );
}
