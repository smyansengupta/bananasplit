import { withSystemOrgTx } from "@/server/db/context";

import { enqueueJob } from "./enqueue";

/**
 * Enqueues today's platform maintenance jobs (the unverified-account purge
 * and the pruning job). Keys are per UTC date with once=true, so calling
 * this on every cron tick is cheap and each runs once a day.
 */
export async function scheduleDailyMaintenance(now: Date = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  await withSystemOrgTx(null, async ({ db }) => {
    await enqueueJob(db, {
      orgId: null,
      kind: "purge-unverified",
      key: day,
      payload: {},
      once: true,
      noKick: true,
    });
    await enqueueJob(db, {
      orgId: null,
      kind: "maintenance",
      key: day,
      payload: {},
      once: true,
      noKick: true,
    });
  });
}
