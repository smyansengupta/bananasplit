import { after } from "next/server";

import { appOrigin } from "@/lib/app-url";

import { jobKind, type JobKind } from "./registry";

/**
 * The after() kick pattern ('Background jobs' decision, item 8), scheduled
 * by enqueueJob after the enqueuing transaction commits:
 *
 * - after()-eligible kinds (maxRuntime <= 30s): the enqueuing request's
 *   after() drains due fast jobs, `drainJobs({ fast: true, limit: 5 })`,
 *   inside the route's own maxDuration. Mail goes out seconds after the
 *   click instead of at the next cron.
 * - heavy kinds: the request's after() POSTs /api/cron/jobs?kind=<kind>
 *   with CRON_SECRET and waits only for the 202; that separate invocation
 *   drains in its own after(), inside its own 300s maxDuration. A heavy kind
 *   never runs in a user request.
 * - other kinds (scheduled ones: site-rebuild, digests, maintenance) wait for
 *   /api/cron/jobs.
 *
 * Outside a request (scripts, the CLI drain, tests) after() is unavailable
 * and the kick is skipped; the cron or `pnpm jobs:drain` picks the job up.
 * Within one process, one pending drain per request burst is enough: a
 * second kick while one is queued is dropped (the queued drain sees both).
 */

/** Slot -> when its after() was scheduled. */
const pending = new Map<string, number>();

/**
 * A slot whose after() has not started within this long is treated as lost
 * (an aborted request whose after() never ran) and no longer suppresses kicks.
 */
const STALE_SLOT_MS = 30_000;

function scheduleAfter(slot: string, work: () => Promise<unknown>): void {
  const since = pending.get(slot);
  if (since !== undefined && Date.now() - since < STALE_SLOT_MS) return;
  try {
    after(async () => {
      pending.delete(slot);
      try {
        await work();
      } catch (error) {
        console.error(`[jobs] ${slot} kick failed`, error instanceof Error ? error.message : error);
      }
    });
    pending.set(slot, Date.now());
  } catch {
    // Not inside a Next.js request: nothing to hang the work on.
  }
}

/** POSTs the kick for a heavy kind and waits only for the 202. */
export async function kickCron(kind: JobKind): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  // Previews sit behind Vercel Deployment Protection.
  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  }
  const res = await fetch(`${appOrigin()}/api/cron/jobs?kind=${encodeURIComponent(kind)}`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status !== 202) {
    console.error(`[jobs] kick for ${kind} answered ${res.status}`);
  }
}

/** Schedules the right follow-up for a freshly enqueued job of `kind`. */
export function scheduleKick(kind: JobKind, options: { due: boolean }): void {
  const def = jobKind(kind);
  if (!def.handler || !options.due) return;
  if (def.afterEligible) {
    scheduleAfter("fast-drain", async () => {
      const { drainJobs } = await import("./drain");
      await drainJobs({ fast: true, limit: 5 });
    });
  } else if (def.tier === "heavy") {
    scheduleAfter(`kick:${kind}`, () => kickCron(kind));
  }
}
