/**
 * Types shared by the job registry, the runner and the handlers.
 * See src/server/jobs/registry.ts for the contract.
 */

/** One claimed job, as the handler sees it. */
export interface JobRun<P> {
  id: string;
  kind: string;
  /** NULL for platform jobs (verify-email, purge-unverified, maintenance). */
  organizationId: string | null;
  payload: P;
  dedupeKey: string;
  /** 1 on the first run. */
  attempt: number;
  maxAttempts: number;
  /** Aborted when the kind's maxRuntime is reached. Pass it to fetch(). */
  signal: AbortSignal;
  /** Epoch ms at which the runner stops waiting for this handler. */
  deadline: number;
}

/**
 * What a handler reports. Returning nothing means DONE. Throwing means RETRY
 * (with backoff, DEAD after maxAttempts), except PermanentJobError, which
 * means DEAD at once. Errors are sanitized before they are stored.
 */
export type JobOutcome =
  | { status: "DONE" }
  | { status: "RETRY"; error: string }
  | { status: "DEAD"; error: string }
  | { status: "CANCELLED"; error?: string };

export type JobHandler<P> = (run: JobRun<P>) => Promise<JobOutcome | void>;

/** A failure retrying cannot fix (bad payload, row gone, config missing). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** The runner gave up waiting at the kind's maxRuntime. */
export class JobTimeoutError extends Error {
  constructor(kind: string, ms: number) {
    super(`${kind} exceeded its ${Math.round(ms / 1000)}s maxRuntime`);
    this.name = "JobTimeoutError";
  }
}

/** A Job row as app.claim_jobs returns it. */
export interface ClaimedJobRow {
  id: string;
  organizationId: string | null;
  kind: string;
  payload: unknown;
  dedupeKey: string;
  runAt: Date;
  status: string;
  attempts: number;
  maxAttempts: number;
  lockedUntil: Date | null;
  lockToken: string | null;
  rerunRequested: boolean;
}
