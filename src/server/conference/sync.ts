import {
  CalendarSyncState,
  ConferenceProvider,
  IntegrationStatus,
  MeetingFormat,
  Prisma,
} from "@/generated/prisma/client";
import { safeTimeZone } from "@/lib/calendar/dates";
import { withSystemOrgTx } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";
import { sanitize } from "@/server/jobs/sanitize";

import { clientFor } from "./clients";
import { providerForConference } from "./providers";
import { markConferenceNeedsReauth } from "./reauth";
import {
  ConferenceApiError,
  ConferenceNotConfiguredError,
  ConferenceReauthError,
  type ConferenceDraft,
  type ConferenceMeeting,
} from "./types";

/**
 * The conference-sync job: makes an event's online meeting real
 * (docs/features/meetings.md).
 *
 * Same contract as the Google mirror next door (src/server/google-calendar):
 * short transactions to read a snapshot and to write the result, the provider
 * call in between with NO transaction open, and a compare-and-set on
 * `syncVersion` so a save that lands while we were on the network wins and
 * leaves the row PENDING for the job that save queued.
 *
 * Why a job and not part of the save: a provider being slow or down must
 * never cost someone the meeting they just typed in. The event saves at once,
 * the link arrives seconds later, and a failure is a state on the row
 * (conferenceSyncState FAILED plus a sanitized reason) rather than an error
 * where the person was typing.
 *
 * We only ever touch a meeting WE made: `conferenceManaged` is the flag, and
 * a link someone pasted by hand is never moved or cancelled.
 */

const SNAPSHOT = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  deletedAt: true,
  mergedIntoId: true,
  format: true,
  conferenceProvider: true,
  conferenceManaged: true,
  conferenceMeetingId: true,
  conferenceManagedAt: true,
  conferenceUrl: true,
  conferenceSyncAttempts: true,
  syncVersion: true,
} satisfies Prisma.EventSelect;

type Snapshot = Prisma.EventGetPayload<{ select: typeof SNAPSHOT }>;

/** What the row should be, given the event: a meeting, or none. */
type Intent = "create" | "update" | "remove" | "nothing";

/**
 * What this event wants, against what it has.
 *
 * `conferenceProvider` is what is WANTED; `conferenceManagedAt` is where a
 * meeting we made actually lives. They differ while a teardown is pending:
 * turning the call off, or switching from Zoom to Meet, changes the want
 * first. A switch cancels at the old provider on this run and leaves the row
 * PENDING, so the next run creates at the new one.
 */
function intentFor(event: Snapshot): Intent {
  const gone = event.deletedAt !== null || event.mergedIntoId !== null;
  const wantsOnline =
    !gone &&
    event.format !== MeetingFormat.IN_PERSON &&
    event.conferenceProvider !== ConferenceProvider.NONE &&
    event.conferenceProvider !== ConferenceProvider.OTHER;
  const has = event.conferenceManaged && event.conferenceMeetingId && event.conferenceManagedAt;

  if (!wantsOnline) return has ? "remove" : "nothing";
  if (!has) {
    // A pasted link stays a pasted link: nothing to create.
    return event.conferenceUrl && !event.conferenceManaged ? "nothing" : "create";
  }
  // Moved to a different provider: cancel the old meeting first.
  return event.conferenceManagedAt === event.conferenceProvider ? "update" : "remove";
}

/** The provider a remove or update must talk to: where the meeting lives. */
function clientProviderFor(event: Snapshot, intent: Intent): ConferenceProvider {
  return intent === "create" ? event.conferenceProvider : (event.conferenceManagedAt ?? event.conferenceProvider);
}

function draftOf(event: Snapshot, timeZone: string): ConferenceDraft {
  return {
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timeZone: safeTimeZone(timeZone),
    allDay: event.allDay,
  };
}

/** The fields a successful create or update writes. */
function savedFields(meeting: ConferenceMeeting, provider: ConferenceProvider): Prisma.EventUpdateInput {
  return {
    conferenceManaged: true,
    conferenceManagedAt: provider,
    conferenceMeetingId: meeting.meetingId,
    conferenceUrl: meeting.joinUrl,
    conferenceHostUrl: meeting.hostUrl,
    conferencePasscode: meeting.passcode,
    conferenceDialIn:
      meeting.dialIn.length > 0
        ? (meeting.dialIn as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull,
    conferenceSyncState: CalendarSyncState.SYNCED,
    conferenceSyncAttempts: 0,
    conferenceSyncedAt: new Date(),
    conferenceSyncError: null,
  };
}

/**
 * The fields a cancellation writes: the meeting we made is gone, and so is
 * everything that pointed at it.
 *
 * Except a link someone pasted in its place. Editing a meeting we made to "A
 * link I'll paste" changes the provider to OTHER and the URL to theirs in the
 * same save (the picker drops our link on any switch), so by the time this
 * runs the URL on the row is not ours. A pasted link is never touched: it
 * stays, and only our meeting's own fields are cleared.
 */
function clearedFields(event: Snapshot): Prisma.EventUpdateInput {
  return {
    conferenceManaged: false,
    conferenceManagedAt: null,
    conferenceMeetingId: null,
    ...(event.conferenceProvider === ConferenceProvider.OTHER ? {} : { conferenceUrl: null }),
    conferenceHostUrl: null,
    conferencePasscode: null,
    conferenceDialIn: Prisma.DbNull,
    conferenceSyncState: CalendarSyncState.NOT_APPLICABLE,
    conferenceSyncAttempts: 0,
    conferenceSyncedAt: new Date(),
    conferenceSyncError: null,
  };
}

/**
 * Writes the result only while syncVersion still matches what we read. A
 * mismatch means the event was saved again while we were at the provider:
 * that save queued its own job, so this one steps aside.
 */
async function commit(
  orgId: string,
  eventId: string,
  version: number,
  data: Prisma.EventUpdateInput,
): Promise<boolean> {
  return withSystemOrgTx(orgId, async ({ db }) => {
    const moved = await db.event.updateMany({
      where: { organizationId: orgId, id: eventId, syncVersion: version },
      data,
    });
    return moved.count === 1;
  });
}

/**
 * Forgets the meeting we made and leaves the row PENDING for a new one, with
 * the job that makes it queued in the same transaction, so the row is never
 * PENDING with nothing coming to resolve it. Two paths need it: a switch to
 * another provider (cancelled at the old one, made at the new one), and a
 * move the provider answered 404 to (the meeting is gone there, but this
 * event still wants one).
 *
 * The job key is fresh because the job running now holds the plain one. A
 * commit that lost the compare-and-set queues nothing: the newer save queued
 * its own job, which sees the same state and does the same.
 */
async function commitAndRecreate(
  orgId: string,
  event: Snapshot,
  why: "switch" | "recreate",
): Promise<void> {
  await withSystemOrgTx(orgId, async ({ db }) => {
    const moved = await db.event.updateMany({
      where: { organizationId: orgId, id: event.id, syncVersion: event.syncVersion },
      data: { ...clearedFields(event), conferenceSyncState: CalendarSyncState.PENDING },
    });
    if (moved.count !== 1) return;
    await enqueueJob(db, {
      orgId,
      kind: "conference-sync",
      key: `${event.id}:${why}:${Date.now()}`,
      payload: { eventId: event.id },
    });
  });
}

async function recordFailure(
  orgId: string,
  eventId: string,
  error: unknown,
  attempts: number,
): Promise<void> {
  await withSystemOrgTx(orgId, async ({ db }) => {
    await db.event.updateMany({
      where: { organizationId: orgId, id: eventId },
      data: {
        conferenceSyncState: CalendarSyncState.FAILED,
        conferenceSyncAttempts: attempts + 1,
        conferenceSyncError: sanitize(error, 500),
      },
    });
  });
}

export const conferenceSyncJob: JobHandler<{ eventId: string }> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("conference-sync without an organizationId");
  const { eventId } = run.payload;

  const snapshot = await withSystemOrgTx(orgId, async ({ db }) => {
    const event = await db.event.findFirst({
      where: { id: eventId, organizationId: orgId },
      select: SNAPSHOT,
    });
    if (!event) return null;
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { timezone: true },
    });
    const def = providerForConference(event.conferenceProvider);
    const integration = def
      ? await db.orgIntegration.findUnique({
          where: { organizationId_provider: { organizationId: orgId, provider: def.integration } },
          select: { status: true },
        })
      : null;
    return { event, timeZone: org?.timezone ?? "UTC", integrationStatus: integration?.status ?? null };
  });

  // The event was hard-deleted between the save and the job.
  if (!snapshot) return { status: "DONE" } satisfies JobOutcome;

  const { event, timeZone, integrationStatus } = snapshot;
  const intent = intentFor(event);
  if (intent === "nothing") {
    // Nothing to do at the provider, but the row must not sit PENDING over it.
    await commit(orgId, eventId, event.syncVersion, {
      conferenceSyncState: event.conferenceManaged
        ? CalendarSyncState.SYNCED
        : CalendarSyncState.NOT_APPLICABLE,
      conferenceSyncAttempts: 0,
      conferenceSyncError: null,
    });
    return { status: "DONE" };
  }

  const talkTo = clientProviderFor(event, intent);
  const client = clientFor(talkTo);
  const def = providerForConference(talkTo);
  if (!client || !def) {
    throw new PermanentJobError(`${talkTo} has no meeting client`);
  }

  // A connection waiting to be reconnected will fail every time: say so on
  // the row and stop, rather than burning the retry budget.
  if (intent !== "remove" && integrationStatus !== IntegrationStatus.CONNECTED) {
    const why =
      integrationStatus === IntegrationStatus.NEEDS_REAUTH
        ? `${def.label} needs to be reconnected from Meetings.`
        : `${def.label} is not connected for this organization.`;
    await recordFailure(orgId, eventId, why, event.conferenceSyncAttempts);
    return { status: "DEAD", error: why };
  }

  const ctx = { orgId, signal: run.signal };
  try {
    if (intent === "remove") {
      await client.remove(event.conferenceMeetingId!, ctx);
      // A switch still wants a meeting, just somewhere else: leave the row
      // PENDING and let the job this commit queues create it there.
      const switching =
        event.format !== MeetingFormat.IN_PERSON &&
        providerForConference(event.conferenceProvider) !== null &&
        event.conferenceProvider !== event.conferenceManagedAt;
      if (switching) await commitAndRecreate(orgId, event, "switch");
      else await commit(orgId, eventId, event.syncVersion, clearedFields(event));
      return { status: "DONE" };
    }
    const draft = draftOf(event, timeZone);
    const meeting =
      intent === "create"
        ? await client.create(draft, ctx)
        : await client.update(event.conferenceMeetingId!, draft, ctx);
    await commit(orgId, eventId, event.syncVersion, savedFields(meeting, talkTo));
    return { status: "DONE" };
  } catch (error) {
    if (error instanceof ConferenceReauthError) {
      await markConferenceNeedsReauth(orgId, error.integration, error);
      await recordFailure(orgId, eventId, error, event.conferenceSyncAttempts);
      // Retrying cannot help until someone reconnects, and reconnecting
      // queues the work again.
      return { status: "DEAD", error: sanitize(error, 300) };
    }
    if (error instanceof ConferenceNotConfiguredError) {
      await recordFailure(orgId, eventId, error, event.conferenceSyncAttempts);
      throw error; // PermanentJobError: DEAD at once
    }
    if (error instanceof ConferenceApiError && !error.retryable) {
      if (error.status === 404 && intent === "update") {
        // We were moving a meeting the provider no longer has: its host
        // deleted it there, or the connection now belongs to another account.
        // The event still wants a call, so forget the dead one and make a
        // new one, rather than leaving the meeting with no link and nothing
        // to retry.
        await commitAndRecreate(orgId, event, "recreate");
        return { status: "DONE" };
      }
      // A meeting the provider says is gone is the state a cancellation
      // wanted anyway: clear our copy instead of failing forever.
      if (error.status === 404 && intent === "remove") {
        await commit(orgId, eventId, event.syncVersion, clearedFields(event));
        return { status: "DONE" };
      }
      await recordFailure(orgId, eventId, error, event.conferenceSyncAttempts);
      return { status: "DEAD", error: sanitize(error, 300) };
    }
    await recordFailure(orgId, eventId, error, event.conferenceSyncAttempts);
    throw error; // retry with backoff
  }
};
