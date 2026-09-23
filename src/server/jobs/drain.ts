import { runAsBackgroundWork } from "@/server/cache/invalidate";
import { serviceDb } from "@/server/db/clients";
import { runOutsideTx } from "@/server/db/context";
import { emailDelivery } from "@/server/email/config";

import { implementedKinds, isJobKind, jobKind, leaseMap, type JobKind } from "./registry";
import { sanitize } from "./sanitize";
import {
  JobTimeoutError,
  PermanentJobError,
  type ClaimedJobRow,
  type JobOutcome,
  type JobRun,
} from "./types";

/**
 * The job runner. Every job goes through three steps:
 *
 *   1. claim   app.claim_jobs(leases, n): one short autocommit statement on
 *              the service role. It commits before any I/O.
 *   2. run     the kind's handler, with NO transaction open, bounded by an
 *              AbortController at the kind's maxRuntime. Network I/O happens
 *              here. Handlers open their own short withSystemOrgTx when they
 *              need the database.
 *   3. finish  app.finish_job(id, lockToken, outcome, error): a compare-and-
 *              set on the lock token. A lost lease returns false and the
 *              result is discarded (the side effects are idempotent).
 *
 * Budget: a kind is claimed only when the remaining budget covers its
 * maxRuntime, and at most one heavy job runs per invocation (concurrently
 * with the fast ones). drainJobs({ fast: true }) (the after() drain of a
 * user request) never claims a heavy or non-after() kind.
 *
 * Refusals: on a Vercel preview the drain refuses unless the database
 * carries app.fixture_only = 'on' (D9), so a preview never runs jobs against
 * real data. While EMAIL_DELIVERY=off the email kinds are not claimed; they
 * wait PENDING until delivery is switched on.
 */

export interface DrainOptions {
  /** Only after()-eligible kinds (a user request's after()). */
  fast?: boolean;
  /** Restrict to these kinds. */
  kinds?: readonly JobKind[];
  /** Maximum number of jobs to claim in this call (default 50). */
  limit?: number;
  /**
   * Wall-clock budget in ms (default 55s, which fits a user request under a
   * 60s maxDuration; /api/cron/jobs passes ~270s). A kind is claimed only
   * while the remaining budget covers its maxRuntime plus a finish margin.
   */
  budgetMs?: number;
}

export interface DrainSummary {
  claimed: number;
  done: number;
  retried: number;
  dead: number;
  cancelled: number;
  /** finish_job refused: the lease was lost and the job is someone else's. */
  lost: number;
  /** Why nothing ran, if the drain refused. */
  refused?: string;
  kinds: Record<string, number>;
}

/** Headroom between a handler's maxRuntime and the budget end (finish + claim). */
const FINISH_MARGIN_MS = 5_000;
/** Default drain budget: under a 60s route maxDuration. */
const DEFAULT_BUDGET_MS = 55_000;
/** Fast jobs claimed (and run concurrently) per round; below the pool size of 5. */
const FAST_BATCH = 3;

let previewCheck: { at: number; refusal: string | null } | null = null;

/** Why the drain must not run here, or null. Exported for tests. */
export async function drainRefusal(
  env: Record<string, string | undefined> = process.env,
): Promise<string | null> {
  if (env.VERCEL_ENV !== "preview") return null;
  if (previewCheck && Date.now() - previewCheck.at < 60_000) return previewCheck.refusal;
  let refusal: string | null = null;
  try {
    const rows = await serviceDb.$queryRaw<{ v: string | null }[]>`
      SELECT current_setting('app.fixture_only', true) AS v`;
    if (rows[0]?.v !== "on") {
      refusal = "preview database is not marked app.fixture_only = 'on'";
    }
  } catch {
    refusal = "could not verify the preview database marker";
  }
  previewCheck = { at: Date.now(), refusal };
  return refusal;
}

/** Test seam: the SQL the runner issues. */
export const jobStore = {
  async claim(kinds: readonly JobKind[], limit: number): Promise<ClaimedJobRow[]> {
    const leases = JSON.stringify(leaseMap(kinds));
    return serviceDb.$queryRaw<ClaimedJobRow[]>`
      SELECT "id", "organizationId", "kind", "payload", "dedupeKey", "runAt", "status",
             "attempts", "maxAttempts", "lockedUntil", "lockToken", "rerunRequested"
        FROM app.claim_jobs(${leases}::jsonb, ${limit}::int)`;
  },
  async finish(id: string, lockToken: string, outcome: JobOutcome): Promise<boolean> {
    const error = "error" in outcome && outcome.error ? outcome.error : null;
    const rows = await serviceDb.$queryRaw<{ ok: boolean }[]>`
      SELECT app.finish_job(${id}, ${lockToken}, ${outcome.status}, ${error}) AS ok`;
    return rows[0]?.ok === true;
  },
};

/** The kinds this drain may claim. */
export function runnableKinds(
  options: Pick<DrainOptions, "fast" | "kinds">,
  env: Record<string, string | undefined> = process.env,
): JobKind[] {
  const emailOff = emailDelivery(env) === "off";
  return implementedKinds().filter((k) => {
    const def = jobKind(k);
    if (options.kinds && !options.kinds.includes(k)) return false;
    if (options.fast && !def.afterEligible) return false;
    if (emailOff && def.sendsEmail) return false;
    return true;
  });
}

/** Runs one claimed job and reports its outcome (never throws). */
export async function runClaimedJob(row: ClaimedJobRow): Promise<JobOutcome> {
  if (!isJobKind(row.kind)) {
    return { status: "DEAD", error: `unknown job kind ${row.kind}` };
  }
  const def = jobKind(row.kind);
  if (!def.handler) return { status: "RETRY", error: "no handler registered for this kind" };

  const parsed = def.payload.safeParse(row.payload ?? {});
  if (!parsed.success) return { status: "DEAD", error: "invalid payload" };

  const controller = new AbortController();
  const deadline = Date.now() + def.maxRuntimeMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new JobTimeoutError(row.kind, def.maxRuntimeMs);
      controller.abort(error);
      reject(error);
    }, def.maxRuntimeMs);
  });

  const run: JobRun<unknown> = {
    id: row.id,
    kind: row.kind,
    organizationId: row.organizationId,
    payload: parsed.data,
    dedupeKey: row.dedupeKey,
    attempt: row.attempts,
    maxAttempts: row.maxAttempts,
    signal: controller.signal,
    deadline,
  };

  try {
    const handler = await def.handler();
    const result = await Promise.race([
      runOutsideTx(() => runAsBackgroundWork(() => handler(run))),
      timeout,
    ]);
    if (!result) return { status: "DONE" };
    if (result.status === "RETRY" || result.status === "DEAD") {
      return { status: result.status, error: sanitize(result.error) };
    }
    if (result.status === "CANCELLED") {
      return { status: "CANCELLED", error: result.error ? sanitize(result.error) : undefined };
    }
    return result;
  } catch (error) {
    if (error instanceof PermanentJobError) return { status: "DEAD", error: sanitize(error) };
    return { status: "RETRY", error: sanitize(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runAndFinish(row: ClaimedJobRow, summary: DrainSummary): Promise<void> {
  const outcome = await runClaimedJob(row);
  summary.kinds[row.kind] = (summary.kinds[row.kind] ?? 0) + 1;
  if (!row.lockToken) {
    summary.lost += 1;
    return;
  }
  let finished = false;
  try {
    finished = await jobStore.finish(row.id, row.lockToken, outcome);
  } catch (error) {
    // The lease expires and the job is claimed again; nothing else to do.
    console.error(`[jobs] finish ${row.kind} ${row.id} failed`, sanitize(error));
  }
  if (!finished) {
    summary.lost += 1;
    return;
  }
  if (outcome.status === "DONE") summary.done += 1;
  else if (outcome.status === "RETRY") summary.retried += 1;
  else if (outcome.status === "DEAD") summary.dead += 1;
  else summary.cancelled += 1;
  if (outcome.status !== "DONE") {
    console.warn(`[jobs] ${row.kind} ${row.id} -> ${outcome.status}: ${"error" in outcome ? outcome.error : ""}`);
  }
}

/** Claims and runs due jobs until none are left, the limit or the budget runs out. */
export async function drainJobs(options: DrainOptions = {}): Promise<DrainSummary> {
  const summary: DrainSummary = {
    claimed: 0,
    done: 0,
    retried: 0,
    dead: 0,
    cancelled: 0,
    lost: 0,
    kinds: {},
  };
  const refusal = await drainRefusal();
  if (refusal) return { ...summary, refused: refusal };

  const kinds = runnableKinds(options);
  if (kinds.length === 0) return summary;

  const started = Date.now();
  const deadline = started + (options.budgetMs ?? DEFAULT_BUDGET_MS);
  const limit = options.limit ?? 50;
  const remaining = () => deadline - Date.now() - FINISH_MARGIN_MS;
  const fits = (k: JobKind) => jobKind(k).maxRuntimeMs <= remaining();

  // At most one heavy job per invocation, started first so a stream of fast
  // jobs cannot starve it, and run alongside the fast loop.
  let heavy: Promise<void> = Promise.resolve();
  if (!options.fast) {
    const heavyKinds = kinds.filter((k) => jobKind(k).tier === "heavy" && fits(k));
    if (heavyKinds.length > 0 && summary.claimed < limit) {
      const rows = await jobStore.claim(heavyKinds, 1);
      summary.claimed += rows.length;
      heavy = Promise.all(rows.map((row) => runAndFinish(row, summary))).then(() => undefined);
    }
  }

  // Each batch runs concurrently, so every job in it finishes (or times out)
  // within its maxRuntime, well inside its lease: a claimed job never waits
  // behind its batch-mates long enough for the lease to lapse.
  while (summary.claimed < limit) {
    const fastKinds = kinds.filter((k) => jobKind(k).tier === "fast" && fits(k));
    if (fastKinds.length === 0) break;
    const rows = await jobStore.claim(fastKinds, Math.min(FAST_BATCH, limit - summary.claimed));
    if (rows.length === 0) break;
    summary.claimed += rows.length;
    await Promise.all(rows.map((row) => runAndFinish(row, summary)));
  }

  await heavy;
  return summary;
}
