import { withSystemOrgTx } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

/**
 * The CRM's nightly upkeep: once a day per organization that has the CRM
 * set up, a crm-refresh (mirror the workspace onto timelines, recompute
 * relationship strength, look for duplicates). Called by the daily cron
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
    return id ? 1 : 0;
  });
}
