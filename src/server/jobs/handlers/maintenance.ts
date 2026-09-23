import { authDb, serviceDb } from "@/server/db/clients";

import type { JobHandler } from "../types";

/**
 * Platform maintenance handlers, scheduled once a day by /api/cron/jobs
 * (scheduleDailyMaintenance) with once=true keys per UTC date.
 */

/** Rate-limit buckets are kept 40 days: longer than the longest window (30 days). */
export const BUCKET_RETENTION_SECONDS = 40 * 24 * 60 * 60;
/** Finished jobs (DONE, DEAD, CANCELLED) are kept 30 days for debugging. */
export const JOB_RETENTION_DAYS = 30;

/**
 * 0A Fix 4(d): delete credential sign-ups whose email was never verified
 * within 72 hours and that have no Account, no Membership and no
 * OrgMemberHistory. The predicates live in app.purge_unverified_users(),
 * a SECURITY DEFINER function executable by app_auth only (app_auth cannot
 * read Membership itself).
 */
export const purgeUnverifiedJob: JobHandler<unknown> = async () => {
  const rows = await authDb.$queryRaw<{ n: number }[]>`SELECT app.purge_unverified_users() AS n`;
  const n = Number(rows[0]?.n ?? 0);
  if (n > 0) console.info(`[jobs] purge-unverified removed ${n} unverified account(s)`);
};

/** Prunes expired rate-limit buckets and old finished jobs. */
export const maintenanceJob: JobHandler<unknown> = async () => {
  const buckets = await serviceDb.$queryRaw<{ n: number }[]>`
    SELECT app.prune_rate_limit_buckets(${BUCKET_RETENTION_SECONDS}::int) AS n`;
  const jobs = await serviceDb.$queryRaw<{ n: number }[]>`
    SELECT app.prune_jobs(${JOB_RETENTION_DAYS}::int) AS n`;
  console.info(
    `[jobs] maintenance pruned ${Number(buckets[0]?.n ?? 0)} bucket(s) and ${Number(jobs[0]?.n ?? 0)} job(s)`,
  );
};
