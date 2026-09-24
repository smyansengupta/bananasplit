import type { Prisma } from "@/generated/prisma/client";
import { currentTx } from "@/server/db/context";

import { scheduleKick } from "./kick";
import { isJobKind, jobKind, type JobKind, type JobPayload } from "./registry";

/**
 * enqueueJob(db, { orgId, kind, key, payload, runAt?, once? })
 *
 * Writes a Job through app.enqueue_job, using the caller's own `db`, so the
 * job exists only if the caller's transaction commits:
 *   - in a Server Action: ctx.db from withOrgAction (app_user; the org must
 *     be the member org);
 *   - in a job or cron: ctx.db from withSystemOrgTx(orgId) (app_service;
 *     orgId must equal the org GUC, NULL for platform jobs);
 *   - sign-up: authDb (app_auth; platform jobs only).
 *
 * The dedupe key is `${kind}:${key}`. Dedupe is per org: while a job with
 * the same org and key is PENDING a second enqueue merges into it (earliest
 * runAt, latest payload); while it is RUNNING the job re-runs once more
 * after it finishes. `once: true` refuses a key that already finished DONE
 * (daily digests); the function then returns null.
 *
 * After commit, fast kinds are drained in the request's after() and heavy
 * kinds get a kick to /api/cron/jobs (see ./kick.ts).
 */

export type JobDb = Pick<Prisma.TransactionClient, "$queryRaw">;

export interface EnqueueInput<K extends JobKind> {
  orgId: string | null;
  kind: K;
  /** The id part of the dedupe key; the stored key is `${kind}:${key}`. */
  key: string;
  payload: JobPayload<K>;
  runAt?: Date;
  once?: boolean;
  maxAttempts?: number;
  /** Skip the after()/kick scheduling (tests, the runner's own follow-ups). */
  noKick?: boolean;
}

export class InvalidJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidJobError";
  }
}

const KEY = /^[A-Za-z0-9_.:-]{1,250}$/;
const EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** Rejects anything in a payload that is not an id-like value (no PII, no secrets). */
export function assertIdsOnly(value: unknown, path = "payload"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "number" || typeof value === "boolean") return;
  if (typeof value === "string") {
    if (value.length > 200 || /\s/.test(value) || EMAILISH.test(value)) {
      throw new InvalidJobError(`${path} must hold ids only`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new InvalidJobError(`${path} is too long`);
    value.forEach((v, i) => assertIdsOnly(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertIdsOnly(v, `${path}.${k}`);
    }
    return;
  }
  throw new InvalidJobError(`${path} has an unsupported type`);
}

/** Validates the input and returns what app.enqueue_job receives. */
export function prepareJob<K extends JobKind>(input: EnqueueInput<K>) {
  if (!isJobKind(input.kind)) throw new InvalidJobError(`unknown job kind ${String(input.kind)}`);
  const def = jobKind(input.kind);
  if (def.scope === "org" && !input.orgId) {
    throw new InvalidJobError(`${input.kind} is an org job and needs orgId`);
  }
  if (def.scope === "platform" && input.orgId) {
    throw new InvalidJobError(`${input.kind} is a platform job and takes no orgId`);
  }
  const dedupeKey = `${input.kind}:${input.key}`;
  if (!input.key || !KEY.test(input.key) || dedupeKey.length > 300) {
    throw new InvalidJobError(`invalid job key for ${input.kind}`);
  }
  const parsed = def.payload.safeParse(input.payload);
  if (!parsed.success) {
    throw new InvalidJobError(`invalid ${input.kind} payload: ${parsed.error.issues[0]?.message}`);
  }
  assertIdsOnly(parsed.data);
  const maxAttempts = input.maxAttempts ?? def.maxAttempts ?? 8;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new InvalidJobError("maxAttempts must be 1-20");
  }
  return {
    orgId: input.orgId,
    kind: input.kind,
    dedupeKey,
    payloadJson: JSON.stringify(parsed.data ?? {}),
    runAt: input.runAt ? input.runAt.toISOString() : null,
    maxAttempts,
    once: input.once ?? false,
  };
}

/**
 * Enqueues a job in the caller's transaction. Returns the job id, or null
 * when `once` refused a key that already ran.
 */
export async function enqueueJob<K extends JobKind>(
  db: JobDb,
  input: EnqueueInput<K>,
): Promise<string | null> {
  const job = prepareJob(input);
  const rows = await db.$queryRaw<{ id: string | null }[]>`
    SELECT app.enqueue_job(
      ${job.orgId}, ${job.kind}, ${job.dedupeKey}, ${job.payloadJson}::jsonb,
      ${job.runAt}::timestamp, ${job.maxAttempts}::int, ${job.once}::boolean
    ) AS id`;
  const id = rows[0]?.id ?? null;

  if (id && !input.noKick) {
    const due = !input.runAt || input.runAt.getTime() <= Date.now();
    const tx = currentTx();
    const kick = () => scheduleKick(input.kind, { due });
    if (tx) tx.afterCommit(kick);
    else kick();
  }
  return id;
}
