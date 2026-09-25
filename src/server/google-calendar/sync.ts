import {
  CalendarSyncState,
  EventVisibility,
  IntegrationStatus,
  type Prisma,
} from "@/generated/prisma/client";
import { withSystemOrgTx } from "@/server/db/context";
import { sanitize } from "@/server/jobs/sanitize";
import { PermanentJobError, type JobHandler, type JobRun } from "@/server/jobs/types";

import { createCalendarClient, GoogleApiError, type CalendarClient, type GoogleEvent, type GoogleEventBody } from "./client";
import { loadGoogleIntegration, targetCalendarFor } from "./config";
import { toGoogleEvent } from "./mapping";
import { markNeedsReauth, REAUTH_MESSAGE } from "./reauth";
import { clearAccessToken, getAccessToken, GoogleReauthError } from "./token";

/**
 * The gcal job: mirror ONE suite Event to the org's Google Calendar. The
 * suite database is the source of truth; Google is a one-way mirror.
 *
 * The event service sets googleSyncState PENDING, bumps syncVersion and
 * enqueues gcal:{eventId} in the same transaction as the save. Saves while
 * a job is queued coalesce into it; a save while it runs makes it run once
 * more afterwards (the outbox's rerunRequested), so jobs of one event never
 * overlap and the last save always gets mirrored.
 *
 *   1. read    one short withSystemOrgTx: the event (deleted ones too), its
 *              syncVersion and Google linkage, the org timezone and the
 *              integration.
 *   2. push    no transaction open: token refresh, then delete / patch /
 *              insert against the Google REST API.
 *                - PUBLIC -> publicCalendarId; INTERNAL -> internalCalendarId
 *                  if configured, otherwise it is removed / never created;
 *                  a visibility change moves the event between calendars
 *                  (delete from the old one first).
 *                - insert uses the deterministic id; 409 -> get + patch.
 *                - patch 404/410 -> re-insert; delete 404/410 -> done.
 *   3. write   a second short withSystemOrgTx: SYNCED + googleEventId,
 *              googleEtag, googleHtmlLink ONLY IF syncVersion is unchanged
 *              (compare-and-set). If a newer save landed meanwhile, only the
 *              Google linkage is recorded (so the re-run starts from what
 *              exists in Google) and the newer job does the rest.
 *
 * Failures: invalid_grant -> integration NEEDS_REAUTH, owners and admins
 * alerted once, event FAILED, job CANCELLED (a "Sync now" after reconnecting
 * retries it). Other 4xx -> event FAILED, job DEAD. 5xx / 429 / timeouts ->
 * retried with the runner's backoff; FAILED after the last attempt. Errors
 * are sanitized before they are stored.
 *
 * Sync writes never touch updatedAt or suiteEditedAt: mirroring is not an
 * edit.
 */

export const SYNC_SELECT = {
  id: true,
  organizationId: true,
  title: true,
  description: true,
  location: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  visibility: true,
  rsvpUrl: true,
  conferenceUrl: true,
  publicNote: true,
  capacityFull: true,
  deletedAt: true,
  mergedIntoId: true,
  syncVersion: true,
  googleCalendarId: true,
  googleEventId: true,
  googleSyncState: true,
  updatedAt: true,
} satisfies Prisma.EventSelect;

export type SyncEvent = Prisma.EventGetPayload<{ select: typeof SYNC_SELECT }>;

export interface MirrorLink {
  calendarId: string;
  eventId: string;
  etag: string | null;
  htmlLink: string | null;
}

export type PushOutcome = { kind: "mirrored"; link: MirrorLink } | { kind: "removed" };

/** Test seam: token and client construction. */
export const syncDeps = {
  getAccessToken,
  createClient: (accessToken: string, signal?: AbortSignal): CalendarClient =>
    createCalendarClient({ accessToken, signal }),
};

function linkOf(calendarId: string, g: GoogleEvent): MirrorLink {
  return { calendarId, eventId: g.id, etag: g.etag ?? null, htmlLink: g.htmlLink ?? null };
}

async function insertOrAdopt(client: CalendarClient, calendarId: string, body: GoogleEventBody): Promise<GoogleEvent> {
  try {
    return await client.insertEvent(calendarId, body);
  } catch (error) {
    // 409: the deterministic id exists already (a retried insert whose
    // response was lost, or a mirror deleted in Google). Adopt and overwrite.
    if (!(error instanceof GoogleApiError) || error.status !== 409 || !body.id) throw error;
    await client.getEvent(calendarId, body.id);
    return client.patchEvent(calendarId, body.id, body);
  }
}

/**
 * Makes Google match `event`: the network half of the job. Pure with
 * respect to the database (never call it inside a transaction; the client
 * refuses anyway).
 */
export async function pushToGoogle(
  client: CalendarClient,
  event: SyncEvent,
  plan: { target: string | null; timeZone: string },
): Promise<PushOutcome> {
  let current =
    event.googleEventId && event.googleCalendarId
      ? { calendarId: event.googleCalendarId, eventId: event.googleEventId }
      : null;

  // Leaving a calendar (visibility flip, deletion, merge): delete there first.
  if (current && current.calendarId !== plan.target) {
    try {
      await client.deleteEvent(current.calendarId, current.eventId);
    } catch (error) {
      if (!(error instanceof GoogleApiError && error.gone)) throw error;
    }
    current = null;
  }
  if (!plan.target) return { kind: "removed" };

  const body = toGoogleEvent(event, {
    timeZone: plan.timeZone,
    calendar: event.visibility === EventVisibility.PUBLIC ? "public" : "internal",
  });
  let g: GoogleEvent;
  if (current) {
    try {
      g = await client.patchEvent(plan.target, current.eventId, body);
    } catch (error) {
      if (!(error instanceof GoogleApiError && error.gone)) throw error;
      g = await insertOrAdopt(client, plan.target, body);
    }
  } else {
    g = await insertOrAdopt(client, plan.target, body);
  }
  return { kind: "mirrored", link: linkOf(plan.target, g) };
}

interface Snapshot {
  event: SyncEvent;
  timeZone: string;
  integration: Awaited<ReturnType<typeof loadGoogleIntegration>>;
}

async function readSnapshot(organizationId: string, eventId: string): Promise<Snapshot | null> {
  return withSystemOrgTx(organizationId, async ({ db }) => {
    const event = await db.event.findFirst({ where: { id: eventId, organizationId }, select: SYNC_SELECT });
    if (!event) return null;
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const integration = await loadGoogleIntegration(db, organizationId);
    return { event, timeZone: org?.timezone ?? "UTC", integration };
  });
}

function linkageData(outcome: PushOutcome) {
  return outcome.kind === "mirrored"
    ? {
        googleCalendarId: outcome.link.calendarId,
        googleEventId: outcome.link.eventId,
        googleEtag: outcome.link.etag,
        googleHtmlLink: outcome.link.htmlLink,
      }
    : { googleCalendarId: null, googleEventId: null, googleEtag: null, googleHtmlLink: null };
}

/**
 * The compare-and-set write. Returns true when this job's version won;
 * false when a newer save landed (then only the linkage is recorded).
 */
export async function recordOutcome(
  organizationId: string,
  event: Pick<SyncEvent, "id" | "syncVersion" | "updatedAt">,
  outcome: PushOutcome,
): Promise<boolean> {
  return withSystemOrgTx(organizationId, async ({ db }) => {
    const won = await db.event.updateMany({
      where: { id: event.id, organizationId, syncVersion: event.syncVersion },
      data: {
        ...linkageData(outcome),
        googleSyncState: outcome.kind === "mirrored" ? CalendarSyncState.SYNCED : CalendarSyncState.NOT_APPLICABLE,
        googleSyncedAt: new Date(),
        googleSyncError: null,
        googleSyncAttempts: 0,
        updatedAt: event.updatedAt,
      },
    });
    if (won.count === 1) return true;
    // A newer save won. Record what now exists in Google (still PENDING), so
    // its job deletes or patches this copy instead of losing track of it.
    const now = await db.event.findFirst({
      where: { id: event.id, organizationId },
      select: { syncVersion: true, updatedAt: true },
    });
    if (now) {
      await db.event.updateMany({
        where: { id: event.id, organizationId, syncVersion: now.syncVersion },
        data: { ...linkageData(outcome), updatedAt: now.updatedAt },
      });
    }
    return false;
  });
}

/** Records a failed attempt (compare-and-set, like the success write). */
export async function recordFailure(
  organizationId: string,
  event: Pick<SyncEvent, "id" | "syncVersion" | "updatedAt">,
  error: unknown,
  opts: { final: boolean; attempt: number },
): Promise<void> {
  await withSystemOrgTx(organizationId, async ({ db }) => {
    await db.event.updateMany({
      where: { id: event.id, organizationId, syncVersion: event.syncVersion },
      data: {
        googleSyncState: opts.final ? CalendarSyncState.FAILED : CalendarSyncState.PENDING,
        googleSyncError: sanitize(error, 300),
        googleSyncAttempts: opts.attempt,
        updatedAt: event.updatedAt,
      },
    });
  });
}

/** Nothing to mirror (no connection, or the event must not be on Google). */
async function settleNotApplicable(
  organizationId: string,
  event: SyncEvent,
  opts: { clearLinkage: boolean },
): Promise<void> {
  await withSystemOrgTx(organizationId, async ({ db }) => {
    await db.event.updateMany({
      where: { id: event.id, organizationId, syncVersion: event.syncVersion },
      data: {
        googleSyncState: CalendarSyncState.NOT_APPLICABLE,
        googleSyncError: null,
        googleSyncAttempts: 0,
        ...(opts.clearLinkage ? linkageData({ kind: "removed" }) : {}),
        updatedAt: event.updatedAt,
      },
    });
  });
}

function orgOf(run: JobRun<unknown>): string {
  if (!run.organizationId) throw new PermanentJobError("gcal is an org job");
  return run.organizationId;
}

export const gcalJob: JobHandler<{ eventId: string }> = async (run) => {
  const organizationId = orgOf(run);
  const snapshot = await readSnapshot(organizationId, run.payload.eventId);
  if (!snapshot) return; // hard-deleted (org purge): nothing left to mirror
  const { event, timeZone, integration } = snapshot;

  if (!integration || integration.status === IntegrationStatus.DISCONNECTED) {
    // Keep the linkage: reconnecting to the same calendar patches in place.
    await settleNotApplicable(organizationId, event, { clearLinkage: false });
    return;
  }
  if (integration.status === IntegrationStatus.NEEDS_REAUTH) {
    await recordFailure(organizationId, event, REAUTH_MESSAGE, { final: true, attempt: run.attempt });
    return { status: "CANCELLED", error: "Google Calendar needs to be reconnected" };
  }

  const target = targetCalendarFor(event, integration.config);
  if (!target && !event.googleEventId) {
    await settleNotApplicable(organizationId, event, { clearLinkage: true });
    return;
  }

  try {
    const accessToken = await syncDeps.getAccessToken(organizationId, { signal: run.signal });
    const client = syncDeps.createClient(accessToken, run.signal);
    const outcome = await pushToGoogle(client, event, { target, timeZone });
    await recordOutcome(organizationId, event, outcome);
  } catch (error) {
    if (error instanceof GoogleReauthError) {
      await markNeedsReauth(organizationId, error.message);
      await recordFailure(organizationId, event, REAUTH_MESSAGE, { final: true, attempt: run.attempt });
      return { status: "CANCELLED", error: "Google Calendar needs to be reconnected" };
    }
    if (error instanceof GoogleApiError && error.status === 401) clearAccessToken(organizationId);
    const permanent =
      error instanceof PermanentJobError || (error instanceof GoogleApiError && !error.retryable);
    await recordFailure(organizationId, event, error, {
      final: permanent || run.attempt >= run.maxAttempts,
      attempt: run.attempt,
    });
    if (permanent && !(error instanceof PermanentJobError)) throw new PermanentJobError(sanitize(error, 300));
    throw error;
  }
};
