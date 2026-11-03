import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

import { scheduleCrmDaily } from "./daily";

/**
 * The CRM's nightly upkeep: once a day per organization that has the CRM
 * set up, a crm-refresh (mirror the workspace onto timelines, recompute
 * relationship strength, look for duplicates), and a crm-daily (scheduled
 * workflows, scores, signals, forecast snapshots). Called by the daily cron
 * (/api/cron/task-digest); the once key makes a second call that day a
 * no-op.
 */
export async function scheduleCrmRefresh(orgId: string, now: Date = new Date()): Promise<number> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const settings = await db.orgSettings.findUnique({
      where: { organizationId: orgId },
      select: { addOns: true },
    });
    if (!settings?.addOns.includes("crm")) return 0;
    const crm = await db.crmSettings.findUnique({ where: { organizationId: orgId }, select: { setupDoneAt: true } });
    if (!crm?.setupDoneAt) return 0;
    const id = await enqueueJob(db, {
      orgId,
      kind: "crm-refresh",
      key: `${orgId}:${now.toISOString().slice(0, 10)}`,
      payload: {},
      once: true,
      noKick: true,
    });
    // Automation and numbers: scheduled workflows, scores, signals, forecast snapshots.
    await scheduleCrmDaily(db, orgId, now);
    return id ? 1 : 0;
  });
}

export type RefreshSource =
  | { kind: "user"; id: string }
  | { kind: "contact"; id: string }
  | { kind: "registration"; id: string }
  | { kind: "response"; id: string };

/**
 * Something just happened in the workspace that lands on a CRM timeline (a
 * form answer, an RSVP, a check-in): queue a crm-refresh for whoever it
 * matches, right away instead of at the nightly run. The job resolves the
 * person on the service path (a member's view may not include them) and
 * mirrors just their timeline; a burst of changes merges into the one
 * pending job per source (the job's key). Never fails the caller: one
 * cheap read, then an enqueue, in the caller's transaction (member or
 * service), and only for organizations with the CRM set up.
 */
export async function queueCrmRefreshFor(db: TxClient, organizationId: string, source: RefreshSource): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(source.id)) return;
  // (A test double of the database may have no CRM at all.)
  const settings = (db as Partial<TxClient>).crmSettings;
  if (!settings) return;
  const crm = await settings.findUnique({ where: { organizationId }, select: { setupDoneAt: true } });
  if (!crm?.setupDoneAt) return;
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "crm-refresh",
    key: `m:${source.kind}:${source.id}`,
    payload: { match: { [source.kind]: source.id } },
  });
}
