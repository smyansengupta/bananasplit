import { IntegrationProvider } from "@/generated/prisma/client";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { kickCron } from "@/server/jobs/kick";

/**
 * Triggers for the website sync. None of them runs the sync: they enqueue
 * the coalesced source-sync job and, where a request is in flight, kick
 * /api/cron/jobs, which runs it in its own invocation (a heavy kind never
 * runs inside a user request).
 *
 *   "Sync now" (ADMIN+)            key source-sync:{integrationId}:all
 *   stale-on-view (data > 10 min)  the same key
 *   the hourly backstop            source-sync:{integrationId}:h{yyyymmddhh},
 *                                  scheduled by each run for the next hour,
 *                                  so the chain survives failed runs
 *   the weekly reconcile           decided inside the run (last one > 7 days
 *                                  ago), or forced with stream "reconcile"
 */

export const STALE_AFTER_MS = 10 * 60 * 1000;
export const RECONCILE_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

export function syncKey(integrationId: string): string {
  return `${integrationId}:all`;
}

/** The backstop key and time for the hour after `now`. */
export function backstop(
  integrationId: string,
  now: Date = new Date(),
): { key: string; runAt: Date } {
  const runAt = new Date(now.getTime());
  runAt.setUTCMinutes(0, 0, 0);
  runAt.setUTCHours(runAt.getUTCHours() + 1);
  const stamp = runAt.toISOString().slice(0, 13).replace(/[-T]/g, "");
  return { key: `${integrationId}:h${stamp}`, runAt };
}

/** Enqueues a sync of every stream (or a forced reconcile) in the caller's transaction. */
export async function requestSync(
  db: TxClient,
  organizationId: string,
  integrationId: string,
  options: { reconcile?: boolean; noKick?: boolean } = {},
): Promise<string | null> {
  return enqueueJob(db, {
    orgId: organizationId,
    kind: "source-sync",
    key: syncKey(integrationId),
    payload: { integrationId, stream: options.reconcile ? "reconcile" : "all" },
    noKick: options.noKick,
  });
}

const recentKicks = new Map<string, number>();

/**
 * Stale-on-view: when a synced database is opened and the org's data is
 * older than 10 minutes, enqueue the coalesced job and kick the drain. Runs
 * on the service path (members cannot read integration rows) and only
 * touches sync metadata. Throttled per org and process to one kick every
 * two minutes. Call it from after(), never before the page renders.
 */
export async function syncIfStale(
  organizationId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const last = recentKicks.get(organizationId);
  if (last && now.getTime() - last < 2 * 60 * 1000) return false;
  const enqueued = await withSystemOrgTx(organizationId, async ({ db }) => {
    const integration = await db.orgIntegration.findFirst({
      where: {
        organizationId,
        provider: IntegrationProvider.SUPABASE_SOURCE,
        status: { in: ["CONNECTED", "ERROR"] },
      },
      select: { id: true },
    });
    if (!integration) return false;
    const newest = await db.dataSourceSyncState.findFirst({
      where: { organizationId, integrationId: integration.id, stream: "checkins" },
      select: { lastSyncedAt: true },
    });
    if (newest?.lastSyncedAt && now.getTime() - newest.lastSyncedAt.getTime() < STALE_AFTER_MS)
      return false;
    const pending = await db.job.count({
      where: {
        organizationId,
        kind: "source-sync",
        status: { in: ["PENDING", "RUNNING"] },
        runAt: { lte: now },
      },
    });
    if (pending > 0) return false;
    await requestSync(db, organizationId, integration.id, { noKick: true });
    return true;
  });
  if (!enqueued) return false;
  recentKicks.set(organizationId, now.getTime());
  await kickCron("source-sync").catch(() => undefined);
  return true;
}
