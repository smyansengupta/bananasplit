import { withSystemOrgTx } from "@/server/db/context";
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

