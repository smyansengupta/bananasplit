import { z } from "zod";

import { MAX_REMINDER_MINUTES } from "@/lib/meetings/reminders";

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

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, "ids only");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoInstant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
/** Minutes before a meeting's start (app.reminder_offsets_ok's range). */
const reminderOffset = z.number().int().min(1).max(MAX_REMINDER_MINUTES);

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
  "password-reset-email": kind({
    payload: z.object({ userId: id }).strict(),
    scope: "platform",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/email/jobs").then((m) => m.passwordResetEmailJob),
    description: "A password-reset link (platform sender), enqueued by app_auth.",
  }),
  "password-changed-email": kind({
    payload: z.object({ userId: id }).strict(),
    scope: "platform",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/email/jobs").then((m) => m.passwordChangedEmailJob),
    description: "The notice after a password reset (platform sender), enqueued by app_auth.",
  }),

  // ---- Tasks (Phase 6; handlers owned by B6) ----
  "task-reminder": kind({
    payload: z
      .object({
        taskId: id,
        userId: id,
        dueDate: isoDate,
        // Absent on jobs enqueued before the due-today and overdue stages: "upcoming".
        stage: z.enum(["upcoming", "today", "overdue"]).optional(),
      })
      .strict(),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/tasks/jobs").then((m) => m.taskReminderJob),
    description:
      "Due-date reminder (upcoming, due today, overdue); key task-reminder:{taskId}:{dueDate}:{userId}[:{stage}]. Runs once due.",
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
      "18:00 local reminder, on the club's weekly update day, to a lead who hasn't posted the week's update (once=true), enqueued by /api/cron/task-digest.",
  }),

  // ---- The weekly pulse (src/server/pulse) ----
  "weekly-pulse": kind({
    payload: z.object({ weekStart: isoDate }).strict(),
    scope: "org",
    maxRuntimeMs: 60_000,
    leaseSeconds: 120,
    tier: "fast",
    afterEligible: false,
    handler: () => import("@/server/pulse/jobs").then((m) => m.weeklyPulseJob),
    description:
      "The club's weekly pulse at OrgSettings.pulseDay and pulseHourLocal (once=true per week): compiles and stores the PulseIssue, writes the Team Advanced summary, marks it sent, notifies in-app and queues pulse-email; enqueued by /api/cron/task-digest.",
  }),
  "pulse-email": kind({
    payload: z.object({ issueId: id, userId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: false,
    sendsEmail: true,
    handler: () => import("@/server/pulse/jobs").then((m) => m.pulseEmailJob),
    description:
      "One weekly pulse email to one recipient (Money moved only for finance roles); key pulse-email:{issueId}:{userId}.",
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
  // ---- Meetings (docs/features/meetings.md) ----
  "conference-sync": kind({
    payload: z.object({ eventId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 30_000,
    leaseSeconds: 90,
    tier: "fast",
    // Runs right after the save that queued it, so the join link appears
    // within a second or two of creating the meeting.
    afterEligible: true,
    handler: () => import("@/server/conference/sync").then((m) => m.conferenceSyncJob),
    description:
      "Create, move or cancel one Event's online meeting at Google Meet, Zoom or Teams (key conference-sync:{eventId}; the event service enqueues it).",
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
  // ---- RSVP pages (docs/features/rsvp.md) ----
  "rsvp-email": kind({
    payload: z
      .object({
        registrationId: id,
        template: z.enum([
          "registered",
          "waitlisted",
          "promoted",
          "reminder",
          // Queued by the code before reminder offsets, and still pending
          // when it deploys: read as "reminder" at 1440 and 60 minutes.
          "reminder-day",
          "reminder-hour",
          "event-cancelled",
        ]),
        /** "reminder": how many minutes before the start it is for. */
        offsetMinutes: reminderOffset.optional(),
        /** Reminders: the start they were queued for (a moved event skips them). */
        startsAt: isoInstant.optional(),
      })
      .strict()
      .refine(
        (p) =>
          p.template !== "reminder" || (p.offsetMinutes !== undefined && p.startsAt !== undefined),
        "a reminder names its offset and start",
      ),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    afterEligible: true,
    sendsEmail: true,
    handler: () => import("@/server/rsvp/jobs").then((m) => m.rsvpEmailJob),
    description:
      "One RSVP email to a guest (confirmation, waitlist, a spot opened, a reminder with a text, cancelled); key rsvp-email:{registrationId}:{template}[...], a reminder's rsvp-email:{registrationId}:reminder:r{offsetMinutes}:{startMinute}. A reminder is claimed as an EventReminderSend row before it is sent and released if the send fails.",
  }),
  "rsvp-fanout": kind({
    payload: z
      .object({
        eventId: id,
        // "day" and "hour" were queued by the code before reminder offsets
        // and are still pending when it deploys: read as "reminder" at 1440
        // and 60 minutes.
        stage: z.enum(["day", "hour", "reminder", "cancelled"]),
        /** "reminder": how many minutes before the start it is for. */
        offsetMinutes: reminderOffset.optional(),
        startsAt: isoInstant.optional(),
      })
      .strict()
      .refine(
        (p) =>
          p.stage !== "reminder" || (p.offsetMinutes !== undefined && p.startsAt !== undefined),
        "a reminder names its offset and start",
      ),
    scope: "org",
    maxRuntimeMs: 20_000,
    leaseSeconds: 60,
    tier: "fast",
    // Queues the emails in bulk, so it is quick: a deleted event's
    // cancellation fan-out runs right after the request instead of waiting
    // for the cron. Reminders have a future runAt, so they still wait.
    afterEligible: true,
    handler: () => import("@/server/rsvp/jobs").then((m) => m.rsvpFanoutJob),
    description:
      "A meeting's reminder at one offset, to members and guests alike (key rsvp-fanout:{eventId}:r{offsetMinutes}:{startMinute}, runAt the start minus the offset; none under a day for an all-day event): an in-app EVENT_REMINDER to each attendee who did not decline, and one rsvp-email, queued in bulk, to each sign-up going; EventReminderSend keeps it to once per person, offset and start. Or the cancellation to everyone signed up when the event is deleted (key rsvp-fanout:{eventId}:cancelled).",
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
    handler: () => import("@/server/sync/job").then((m) => m.sourceSyncJob),
    description:
      "Supabase website-data sync; keys source-sync:{integrationId}:all (Sync now, stale-on-view, continuation) and :h{yyyymmddhh} (hourly backstop).",
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
    handler: () => import("@/server/export/service").then((m) => m.orgExportJob),
    description: "OWNER export of all org data to private Blob (cursor-resumable).",
  }),
  "export-expire": kind({
    payload: z.object({ exportId: id }).strict(),
    scope: "org",
    maxRuntimeMs: 30_000,
    leaseSeconds: 90,
    tier: "fast",
    afterEligible: false,
    handler: () => import("@/server/export/service").then((m) => m.exportExpireJob),
    description: "Delete an export's blob at its expiresAt.",
  }),
  "org-purge": kind({
    payload: z.object({}).strict(),
    scope: "org",
    maxRuntimeMs: 240_000,
    leaseSeconds: 330,
    tier: "heavy",
    afterEligible: false,
    handler: () => import("@/server/settings/purge").then((m) => m.orgPurgeJob),
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
  "storage-reconcile": kind({
    payload: z.object({}).strict(),
    scope: "platform",
    // Every space, one after another: heavy, so it runs alone in a cron invocation.
    maxRuntimeMs: 240_000,
    leaseSeconds: 330,
    tier: "heavy",
    afterEligible: false,
    handler: () => import("./handlers/storage").then((m) => m.storageReconcileJob),
    description:
      "Daily: re-add each space's storage against Organization.storageUsedBytes (drift is logged) and delete direct uploads that never got a row.",
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
