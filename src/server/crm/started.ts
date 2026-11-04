import { cache } from "react";

import type { Role } from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import {
  canSkipCrmStep,
  crmStartedSteps,
  isCrmStartedStep,
  isOwnStartedStep,
  orgSkipEntry,
  OWN_SKIP_KEYS,
  ownSkipKey,
  readCrmSkipped,
  type CrmStartedKey,
  type CrmStartedState,
} from "@/lib/crm/started";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgTx, type OrgContext } from "@/server/db/context";

import { CrmError, type CrmAccess } from "./access";
import { bringInCounts, type BringInCounts } from "./bring-in";
import { loadOrgKeys } from "./org-keys";
import { inboundDomain } from "./outreach/mailbox";
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
  /** What this space can't do, so it isn't asked: AI off the plan, keys it can't read. */
  without: CrmStartedKey[];
  /** Who could be brought in; null when that step is finished. */
  counts: BringInCounts | null;
  /** Incoming mail is set up on this server, so a logging address works. */
  inbound: boolean;
}

async function readOrgKeys(organizationId: string, userId: string, role: Role) {
  try {
    return await loadOrgKeys(organizationId, { userId, role });
  } catch {
    return null;
  }
}

export function loadCrmStarted(input: {
  organizationId: string;
  userId: string;
  role: Role;
  access: CrmAccess;
}): Promise<CrmStartedData> {
  return readCrmStarted(input.organizationId, input.userId, input.role, input.access);
}

/** Once per request (the arguments are the cache's key): Today starts it early, the panel reads the same answer. */
const readCrmStarted = cache(async (
  organizationId: string,
  userId: string,
  role: Role,
  access: CrmAccess,
): Promise<CrmStartedData> => {
  // Saved keys are the organization's own: only an owner or admin reads them.
  const viewP = access.admin ? readOrgKeys(organizationId, userId, role) : Promise.resolve(undefined);
  const read = await withOrgTx(organizationId, async ({ db }) => {
    const member = await db.crmMemberSettings.findFirst({
      where: { organizationId, userId },
      select: { signature: true },
    });
    const booking = await db.crmBookingPage.findFirst({
      where: { organizationId, ownerUserId: userId },
      select: { active: true },
    });
    const own = await db.inboxItemState.findMany({
      where: { organizationId, userId, itemKey: { in: [...OWN_SKIP_KEYS] } },
      select: { itemKey: true },
    });
    const base = {
      mailbox: Boolean(member?.signature?.trim()),
      booking: Boolean(booking?.active),
      own: own.map((o) => o.itemKey),
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
    return {
      ...base,
      org: {
        people: Boolean(person),
        goal: Boolean(goal),
        routed: Boolean(routing && routing.mode !== "off"),
        skipped: settings?.startedSkipped ?? [],
        counts: person ? null : await bringInCounts(db, organizationId),
      },
    };
  });

  let ai = false;
  let phone = false;
  const without: CrmStartedKey[] = [];
  const view = await viewP;
  if (view === null) {
    without.push("ai", "phone");
  } else if (view) {
    const saved = (group: string) =>
      view.keys.some((k) => k.group === group && k.status !== "none");
    ai = saved("ai");
    phone = view.keys.some(
      (k) => (k.id === "telnyx" || k.id === "twilio") && k.status !== "none",
    );
    if (!view.aiOnPlan) without.push("ai");
  }

  return {
    state: {
      kinds: Boolean(access.settings?.setupKinds.length),
      people: read.org?.people ?? false,
      owner: read.org?.routed ?? false,
      mailbox: read.mailbox,
      booking: read.booking,
      goal: read.org?.goal ?? false,
      ai,
      phone,
    },
    skipped: readCrmSkipped(read.org?.skipped ?? [], read.own),
    without,
    counts: read.org?.counts ?? null,
    inbound: Boolean(inboundDomain()),
  };
});

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

/** Hides the panel: every step this viewer has is checked off at once. */
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
  return { org: entries.filter((e) => e.startsWith("crm:")), own: own.map((o) => o.itemKey) };
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
  const others = (await orgEntries(ctx)).filter((e) => !e.startsWith("crm:"));
  const org = keep.filter((k) => !isOwnStartedStep(k)).map(orgSkipEntry);
  await writeOrgEntries(ctx, [...others, ...org], { restored: true });
}
