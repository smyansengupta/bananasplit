import { z } from "zod";

import type { JobHandler } from "./types";

/**
 * The job-kind registry: the single source of truth for every background
 * job's lease, maxRuntime, tier and after() eligibility ('Background jobs'
 * decision, item 7). Later phases cite a row here instead of restating
 * numbers, and add their handler to their row.
 *
 * Contract (every kind):
 * - Enqueue only through enqueueJob() (src/server/jobs/enqueue.ts), inside
 *   the caller's transaction, so a rolled-back write never runs a job.
 * - The runner claims in a short transaction, runs the handler with NO
 *   transaction open (network I/O happens here, bounded by maxRuntime), then
 *   finishes with a compare-and-set on the lock token. A handler that needs
 *   the database opens its own short withSystemOrgTx(job.organizationId).
 * - Handlers are idempotent: a lost lease can run a job twice. Side effects
 *   carry their own compare-and-set (Notification.emailSentAt, the Google
 *   etag and syncVersion, the export row status).
 * - Payloads hold ids only, validated by the kind's zod schema. Never
 *   secrets, never PII (enqueueJob also rejects email-like strings).
 *
 * Rules the registry test asserts: lease >= maxRuntime + 40s; a heavy
 * kind's lease exceeds 300s (the longest invocation that can run it), so a
 * live heavy job is never re-claimed; a kind may run in a user request's
 * after() only with maxRuntime <= 30s; no heavy kind is after()-eligible.
 *
 * A kind without a `handler` is registered but not implemented yet: jobs of
 * that kind are accepted by enqueueJob and wait PENDING, and the runner
 * never claims them until the owning phase adds the handler.
 */

export type JobTier = "fast" | "heavy";

export interface JobKindDefinition<P = unknown> {
  /** zod schema of the payload (ids only). */
  payload: z.ZodType<P>;
  /** Org jobs carry organizationId; platform jobs carry NULL. */
  scope: "org" | "platform";
  /** The runner stops waiting (and retries) after this long. */
  maxRuntimeMs: number;
  /** Seconds a claim stays exclusive; must exceed maxRuntime by 40s. */
  leaseSeconds: number;
  /** heavy kinds run only from /api/cron/jobs (or a kick), one per invocation. */
  tier: JobTier;
  /** May run in the after() of the user request that enqueued it. */
  afterEligible: boolean;
  /** Attempts before DEAD (backoff min(30s * 2^(n-1), 6h)). */
  maxAttempts?: number;
  /** Sends email: held PENDING while EMAIL_DELIVERY=off. */
  sendsEmail?: boolean;
  /** Lazily loaded handler; absent until the owning phase implements it. */
  handler?: () => Promise<JobHandler<P>>;
  /** Who enqueues it and why. */
  description: string;
}

function kind<P>(def: JobKindDefinition<P>): JobKindDefinition<P> {
  return def;
}

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "ids only");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Templates the generic `email` kind can render (src/server/email/jobs.ts). */
export const EMAIL_JOB_TEMPLATES = ["treasurer-digest"] as const;

export const JOB_KINDS = {
  // ---- Email (0B; routed through getOrgMailer / getPlatformMailer) ----
  email: kind({
    payload: z
      .object({
        template: z.enum(EMAIL_JOB_TEMPLATES),
        toUserId: id,
        refs: z.record(z.string().max(40), id).default({}),
      })
      .strict(),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/email/jobs").then((m) => m.emailJob),
    description: "A templated org email to one member (e.g. the treasurer digest).",
  }),
  "notify-email": kind({
    payload: z.object({ notificationId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/email/jobs").then((m) => m.notifyEmailJob),
    description: "The email copy of an in-app Notification (notifyUser).",
  }),
  "invite-email": kind({
    payload: z.object({ invitationId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/email/jobs").then((m) => m.inviteEmailJob),
    description: "An invitation email; the accept link is minted at send time.",
  }),
  "reimbursement-email": kind({
    payload: z
      .object({ transactionId: id, status: z.enum(["APPROVED", "REJECTED", "REIMBURSED"]) })
      .strict(),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/email/jobs").then((m) => m.reimbursementEmailJob),
    description: "An expense status change, to the submitter.",
  }),
  "verify-email": kind({
    payload: z.object({ userId: id }).strict(),
    scope: "platform",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/email/jobs").then((m) => m.verifyEmailJob),
    description: "Sign-up email verification (platform sender), enqueued by app_auth.",
  }),

  // ---- Tasks (Phase 6; handlers owned by B6) ----
  "task-reminder": kind({
    payload: z.object({ taskId: id, userId: id, dueDate: isoDate }).strict(),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/tasks/jobs").then((m) => m.taskReminderJob),
    description: "Due-date reminder; key task-reminder:{taskId}:{dueDate}:{userId}. Runs once due.",
  }),
  "task-digest": kind({
    payload: z.object({ userId: id, localDate: isoDate }).strict(),
    scope: "org",
    maxRuntimeMs: 30_000,
    leaseSeconds: 90,
    tier: "fast",
    afterEligible: false,
    sendsEmail: true,
    handler: () => import("@/server/tasks/jobs").then((m) => m.taskDigestJob),
    description: "Daily task digest per user (once=true), enqueued by /api/cron/task-digest.",
  }),
  "weekly-update-reminder": kind({
    payload: z.object({ userId: id, weekStart: isoDate }).strict(),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: false,
    sendsEmail: true,
    handler: () => import("@/server/tasks/jobs").then((m) => m.weeklyUpdateReminderJob),
    description:
      "Sunday 18:00 local reminder to a lead who hasn't posted the week's update (once=true), enqueued by /api/cron/task-digest.",
  }),

  // ---- Calendar (Phase 7; handlers owned by B7) ----
  gcal: kind({
    payload: z.object({ eventId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 30_000,
    leaseSeconds: 90,
    tier: "fast",
    afterEligible: true,
    handler: () => import("@/server/google-calendar/sync").then((m) => m.gcalJob),
    description: "Mirror one Event to Google Calendar (the event service enqueues it).",
  }),
  "site-rebuild": kind({
    payload: z.object({}).strict(),
    scope: "org",
    maxRuntimeMs: 30_000,
    leaseSeconds: 90,
    tier: "fast",
    afterEligible: false,
    handler: () => import("@/server/public-events/rebuild").then((m) => m.siteRebuildJob),
    description: "POST the org's Netlify build hook after PUBLIC event changes (runAt now+60s).",
  }),
  "google-import": kind({
    payload: z.object({ integrationId: id, mode: z.enum(["dry-run", "apply"]) }).strict(),
    scope: "org",
    maxRuntimeMs: 240_000,
    leaseSeconds: 330,
    tier: "heavy",
    afterEligible: false,
    handler: () => import("@/server/google-calendar/import").then((m) => m.googleImportJob),
    description: "One-time import of existing Google Calendar events on connect.",
  }),
  "google-revoke": kind({
    payload: z.object({ integrationId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    handler: () => import("@/server/google-calendar/revoke").then((m) => m.googleRevokeJob),
    description: "Revoke the Google refresh token after Disconnect.",
  }),

  // ---- Website data (Phase 4b; handler owned by B4) ----
  "source-sync": kind({
    payload: z.object({ integrationId: id, stream: z.string().regex(/^[a-z_]{1,40}$/) }).strict(),
    scope: "org",
    maxRuntimeMs: 150_000,
    leaseSeconds: 330,
    tier: "heavy",
    afterEligible: false,
    description: "Supabase website-data sync; key source-sync:{integrationId}:{stream}.",
  }),

  // ---- Org chart (Phase 3; handler owned by B3) ----
  "claude-parse": kind({
    payload: z.object({ versionId: id, parseAttemptId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 250_000,
    leaseSeconds: 360,
    tier: "heavy",
    afterEligible: false,
    handler: () => import("@/server/org-chart/parse-job").then((m) => m.claudeParseJob),
    description: "Parse an uploaded org-chart document with the org's Claude key.",
  }),

  // ---- Settings danger zone (Phase 1; handlers owned by B1) ----
  "org-export": kind({
    payload: z.object({ exportId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 240_000,
    leaseSeconds: 330,
    tier: "heavy",
    afterEligible: false,
    description: "OWNER export of all org data to private Blob (cursor-resumable).",
  }),
  "export-expire": kind({
    payload: z.object({ exportId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 30_000,
    leaseSeconds: 90,
    tier: "fast",
    afterEligible: false,
    description: "Delete an export's blob at its expiresAt.",
  }),
  "org-purge": kind({
    payload: z.object({}).strict(),
    scope: "org",
    maxRuntimeMs: 240_000,
    leaseSeconds: 330,
    tier: "heavy",
    afterEligible: false,
    description: "Hard-delete an org after the 30-day grace (key org-purge:{orgId}).",
  }),

  // ---- Platform maintenance (this module) ----
  "purge-unverified": kind({
    payload: z.object({}).strict(),
    scope: "platform",
    maxRuntimeMs: 30_000,
    leaseSeconds: 90,
    tier: "fast",
    afterEligible: false,
    handler: () => import("./handlers/maintenance").then((m) => m.purgeUnverifiedJob),
    description:
      "Daily: delete credential sign-ups never verified within 72h, with no Account or Membership (0A Fix 4d).",
  }),
  maintenance: kind({
    payload: z.object({}).strict(),
    scope: "platform",
    maxRuntimeMs: 30_000,
    leaseSeconds: 90,
    tier: "fast",
    afterEligible: false,
    handler: () => import("./handlers/maintenance").then((m) => m.maintenanceJob),
    description: "Daily: prune rate-limit buckets and old finished jobs.",
  }),
};

export type JobKind = keyof typeof JOB_KINDS;

export type JobPayload<K extends JobKind> = z.input<(typeof JOB_KINDS)[K]["payload"]>;

export function isJobKind(value: string): value is JobKind {
  return Object.prototype.hasOwnProperty.call(JOB_KINDS, value);
}

export function jobKind(kind: JobKind): JobKindDefinition<unknown> {
  return JOB_KINDS[kind] as unknown as JobKindDefinition<unknown>;
}

/** Kinds whose handler exists (the only ones the runner claims). */
export function implementedKinds(): JobKind[] {
  return (Object.keys(JOB_KINDS) as JobKind[]).filter((k) => jobKind(k).handler !== undefined);
}

/** The lease map app.claim_jobs takes: kind -> lease seconds. */
export function leaseMap(kinds: readonly JobKind[]): Record<string, number> {
  return Object.fromEntries(kinds.map((k) => [k, jobKind(k).leaseSeconds]));
}
