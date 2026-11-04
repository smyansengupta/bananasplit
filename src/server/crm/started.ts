import { appUrl } from "@/lib/app-url";
import { requirePermission } from "@/lib/auth/permissions";
import { periodOf } from "@/lib/crm/forecast";
import { bookingSlug } from "@/lib/crm/outreach/booking";
import {
  canSkipCrmStep,
  crmStartedSteps,
  isCrmSkipEntry,
  isCrmStartedStep,
  isOwnStartedStep,
  orgSkipEntry,
  OWN_SKIP_KEYS,
  ownSkipKey,
  readCrmSkipped,
  type CrmStartedKey,
  type CrmStartedState,
} from "@/lib/crm/started";
import { localDateKey } from "@/lib/tasks/dates";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgTx, type OrgContext } from "@/server/db/context";

import { CrmError, type CrmAccess } from "./access";
import { bringInCounts, type BringInCounts } from "./bring-in";
import { orgTimeZone } from "./forecast";
import { readOrgRouting } from "./outreach/intake";

/**
 * "Get your CRM started" (docs/features/crm.md, "Getting started"): what's
 * there already, read fresh each time so a step finishes itself the moment
 * the thing exists, and checking steps off (src/lib/crm/started.ts says
 * where). Reads only: nothing here writes on a page load.
 */

export interface CrmStartedData {
  state: CrmStartedState;
  skipped: CrmStartedKey[];
  /** Who could be brought in; null when that step is finished. */
  counts: BringInCounts | null;
  /** Your meeting link without its https://. Not made yet: it ends in "…", its last part unknown. */
  meetingLink: string;
  /** What your emails could end with: your name, and the organization's. */
  signature: string;
  /** This quarter's key in the organization's timezone, for a first goal. */
  quarter: string | null;
}

/** A page on /book as it's shown: no https://. */
function shortLink(slug: string): string {
  return appUrl(`/book/${slug}`).replace(/^https?:\/\//, "");
}

export async function loadCrmStarted(input: {
  organizationId: string;
  userId: string;
  access: CrmAccess;
}): Promise<CrmStartedData> {
  const { organizationId, userId, access } = input;
  const read = await withOrgTx(organizationId, async ({ db }) => {
    const member = await db.crmMemberSettings.findFirst({
      where: { organizationId, userId },
      select: { signature: true },
    });
    const booking = await db.crmBookingPage.findFirst({
      where: { organizationId, ownerUserId: userId },
      select: { active: true, slug: true },
    });
    const own = await db.inboxItemState.findMany({
      where: { organizationId, userId, itemKey: { in: [...OWN_SKIP_KEYS] } },
      select: { itemKey: true },
    });
    const mailbox = Boolean(member?.signature?.trim());
    const user =
      mailbox && booking
        ? null
        : await db.user.findUnique({ where: { id: userId }, select: { name: true } });
    const organization = mailbox
      ? null
      : await db.organization.findUnique({
          where: { id: organizationId },
          select: { name: true },
        });
    const name = user?.name?.trim() ?? "";
    const base = {
      mailbox,
      booking: Boolean(booking?.active),
      own: own.map((o) => o.itemKey),
      meetingLink: shortLink(booking?.slug ?? bookingSlug(name || "meet", "…")),
      signature: (access.personal ? [name] : [name, organization?.name ?? ""])
        .filter(Boolean)
        .join("\n"),
    };
    if (!access.admin) return { ...base, org: null };
    const person = await db.crmPerson.findFirst({
      where: { organizationId, deletedAt: null },
      select: { id: true },
    });
    const goal = await db.crmGoal.findFirst({ where: { organizationId }, select: { id: true } });
    const routing = access.settings ? await readOrgRouting(db, organizationId) : null;
    const settings = await db.orgSettings.findUnique({
      where: { organizationId },
      select: { startedSkipped: true },
    });
    const today = goal ? null : localDateKey(new Date(), await orgTimeZone(db, organizationId));
    return {
      ...base,
      org: {
        people: Boolean(person),
        goal: Boolean(goal),
        routed: Boolean(routing && routing.mode !== "off"),
        skipped: settings?.startedSkipped ?? [],
        counts: person ? null : await bringInCounts(db, organizationId),
        quarter: today ? periodOf("quarter", today).key : null,
      },
    };
  });

  return {
    state: {
      kinds: Boolean(access.settings?.setupKinds.length),
      people: read.org?.people ?? false,
      owner: read.org?.routed ?? false,
      booking: read.booking,
      goal: read.org?.goal ?? false,
      mailbox: read.mailbox,
    },
    skipped: readCrmSkipped(read.org?.skipped ?? [], read.own),
    counts: read.org?.counts ?? null,
    meetingLink: read.meetingLink,
    signature: read.signature,
    quarter: read.org?.quarter ?? null,
  };
}

async function writeOwnSkip(ctx: OrgContext, step: CrmStartedKey, skipped: boolean): Promise<void> {
  const { db, organizationId, userId } = ctx;
  const itemKey = ownSkipKey(step);
  if (!skipped) {
    await db.inboxItemState.deleteMany({ where: { organizationId, userId, itemKey } });
    return;
  }
  const doneAt = new Date();
  await db.inboxItemState.upsert({
    where: { userId_organizationId_itemKey: { userId, organizationId, itemKey } },
    create: { userId, organizationId, itemKey, doneAt },
    update: { doneAt },
  });
}

async function orgEntries(ctx: OrgContext): Promise<string[]> {
  const row = await ctx.db.orgSettings.findUnique({
    where: { organizationId: ctx.organizationId },
    select: { startedSkipped: true },
  });
  return row?.startedSkipped ?? [];
}

async function writeOrgEntries(ctx: OrgContext, entries: readonly string[], diff: object) {
  await ctx.db.orgSettings.update({
    where: { organizationId: ctx.organizationId },
    data: { startedSkipped: [...new Set(entries)] },
    select: { organizationId: true },
  });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "settings.started.updated",
    targetType: "OrgSettings",
    targetId: ctx.organizationId,
    diff: { crm: true, ...diff },
  });
}

/** Checks a step off as not needed, or puts it back. A member's own steps are theirs alone. */
export async function setCrmStepSkipped(
  ctx: OrgContext,
  access: CrmAccess,
  step: unknown,
  skipped: unknown,
): Promise<void> {
  if (!isCrmStartedStep(step) || !canSkipCrmStep(step) || typeof skipped !== "boolean") {
    throw new CrmError("That step isn't on the list.");
  }
  if (isOwnStartedStep(step)) return writeOwnSkip(ctx, step, skipped);
  if (!access.admin) throw new CrmError("Ask an owner or admin.");
  requirePermission(ctx, "settings.general.write");
  const entry = orgSkipEntry(step);
  const current = await orgEntries(ctx);
  await writeOrgEntries(ctx, skipped ? [...current, entry] : current.filter((e) => e !== entry), {
    step,
    skipped,
  });
}

/** What Hide checked off before, so Undo puts exactly that back. */
export interface CrmStartedSnapshot {
  org: string[];
  own: string[];
}

/** Hides the strip: every step this viewer has is checked off at once. */
export async function hideCrmStarted(
  ctx: OrgContext,
  access: CrmAccess,
): Promise<CrmStartedSnapshot> {
  const { db, organizationId, userId } = ctx;
  const steps = crmStartedSteps({ admin: access.admin, personal: access.personal })
    .map((s) => s.key)
    .filter(canSkipCrmStep);
  const own = await db.inboxItemState.findMany({
    where: { organizationId, userId, itemKey: { in: [...OWN_SKIP_KEYS] } },
    select: { itemKey: true },
  });
  const entries = access.admin ? await orgEntries(ctx) : [];
  for (const step of steps.filter(isOwnStartedStep)) await writeOwnSkip(ctx, step, true);
  if (access.admin) {
    requirePermission(ctx, "settings.general.write");
    const org = steps.filter((s) => !isOwnStartedStep(s)).map(orgSkipEntry);
    await writeOrgEntries(ctx, [...entries, ...org], { hidden: true });
  }
  return { org: entries.filter(isCrmSkipEntry), own: own.map((o) => o.itemKey) };
}

/** Undo for hideCrmStarted: what was checked off before, and no more. */
export async function restoreCrmStarted(
  ctx: OrgContext,
  access: CrmAccess,
  previous: CrmStartedSnapshot,
): Promise<void> {
  const keep = readCrmSkipped(previous.org, previous.own);
  for (const step of crmStartedSteps({ admin: false, personal: access.personal })) {
    await writeOwnSkip(ctx, step.key, keep.includes(step.key));
  }
  if (!access.admin) return;
  requirePermission(ctx, "settings.general.write");
  const others = (await orgEntries(ctx)).filter((e) => !isCrmSkipEntry(e));
  const org = keep.filter((k) => !isOwnStartedStep(k)).map(orgSkipEntry);
  await writeOrgEntries(ctx, [...others, ...org], { restored: true });
}
