import { cadenceDue } from "@/lib/crm/outreach/schedule";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";

import { persistConversions } from "./campaigns";

/**
 * The CRM's daily outreach upkeep (`crm-outreach-daily`, queued once a day
 * per organization by the daily cron, scheduleCrmOutreach):
 *
 * - Keep in touch: everyone whose cadence lapsed comes back to the queue
 *   (their next follow-up becomes today), so alumni, donors, mentors and
 *   partners don't drift away.
 * - Campaigns: people who RSVP'd, answered the form or whose item was won
 *   count as converted.
 * - Suggestions from mail that nobody looked at in 30 days expire.
 */

const TURN = 500;

export async function lapseCadences(db: TxClient, organizationId: string, now: Date = new Date()): Promise<{ moved: number; more: boolean }> {
  const rows = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      doNotContact: false,
      status: { in: ["ACTIVE", "ALUMNI"] },
      keepInTouchDays: { not: null },
      OR: [{ nextFollowUpAt: null }, { nextFollowUpAt: { gt: now } }],
    },
    orderBy: { id: "asc" },
    take: 5000,
    select: { id: true, lastContactedAt: true, keepInTouchDays: true, nextFollowUpAt: true },
  });
  let moved = 0;
  for (const p of rows) {
    const due = cadenceDue(p.lastContactedAt, p.keepInTouchDays!, now);
    if (due.getTime() > now.getTime()) continue;
    // Already coming up sooner than the cadence would bring them? Leave it.
    if (p.nextFollowUpAt && p.nextFollowUpAt.getTime() <= due.getTime()) continue;
    await db.crmPerson.update({ where: { id: p.id }, data: { nextFollowUpAt: now } });
    await db.crmFieldHistory.create({
      data: {
        organizationId,
        targetKind: "person",
        targetId: p.id,
        field: "nextFollowUpAt",
        oldValue: p.nextFollowUpAt ? p.nextFollowUpAt.toISOString() : undefined,
        newValue: now.toISOString(),
        source: "automation",
      },
    });
    if (++moved >= TURN) return { moved, more: true };
  }
  return { moved, more: false };
}

export const crmOutreachDailyJob: JobHandler<Record<string, never>> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-outreach-daily needs an organization");
  const now = new Date();
  for (;;) {
    const r = await withSystemOrgTx(orgId, ({ db }) => lapseCadences(db, orgId, now));
    if (!r.more || Date.now() > run.deadline - 10_000) break;
  }
  await withSystemOrgTx(orgId, ({ db }) => persistConversions(db, orgId));
  await withSystemOrgTx(orgId, ({ db }) =>
    db.crmSuggestion.updateMany({
      where: { organizationId: orgId, source: "EMAIL", status: "PENDING", expiresAt: { lt: now } },
      data: { status: "EXPIRED" },
    }),
  );
};

/** Queued by the daily cron, once a day per organization with the CRM set up. */
export async function scheduleCrmOutreach(orgId: string, now: Date = new Date()): Promise<number> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const crm = await db.crmSettings.findUnique({ where: { organizationId: orgId }, select: { setupDoneAt: true } });
    if (!crm?.setupDoneAt) return 0;
    const settings = await db.orgSettings.findUnique({ where: { organizationId: orgId }, select: { addOns: true } });
    if (!settings?.addOns.includes("crm")) return 0;
    const id = await enqueueJob(db, {
      orgId,
      kind: "crm-outreach-daily",
      key: `${orgId}:${now.toISOString().slice(0, 10)}`,
      payload: {},
      once: true,
      noKick: true,
    });
    return id ? 1 : 0;
  });
}
