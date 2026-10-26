import { MeetingFormat, NotificationType, type Prisma } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { reminderLead } from "@/lib/meetings/reminders";
import { formatCents, payLinks, shareCents } from "@/lib/rsvp/pay";
import { parsePayTo } from "@/lib/rsvp/pay-schema";
import { startTime, whenLine } from "@/lib/rsvp/when";
import { safeTimeZone } from "@/lib/calendar/dates";
import { withSystemOrgTx } from "@/server/db/context";
import { getOrgMailer, platformFallbackMailer } from "@/server/email/mailer";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";
import { notifyUsers } from "@/server/notifications";
import { sendSms, SmsSendError, smsDelivery } from "@/server/sms";

import { guestPlace, rsvpEmail, rsvpText } from "./email";
import {
  ALL_DAY_MIN_REMINDER_MINUTES,
  enqueueRsvpEmails,
  registrationCounts,
  type RsvpEmailTemplate,
} from "./service";
import { rsvpManageKey } from "./token";

/**
 * The RSVP jobs (registry rows rsvp-email and rsvp-fanout). Same contract
 * as the other email jobs: short service transactions to read and to mark,
 * the sends with no transaction open.
 *
 * Reminders are one system for members and public guests (docs/features/
 * meetings.md): the fanout runs at each of a meeting's reminder offsets
 * (scheduleEventReminders) and reminds both, and EventReminderSend is the
 * once-only guard, one row per recipient, offset and channel, written on
 * this service path only.
 */

type Db = Prisma.TransactionClient;

function requireOrg(orgId: string | null): string {
  if (!orgId) throw new PermanentJobError("org job without an organizationId");
  return orgId;
}

const sameInstant = (a: Date, iso: string | undefined) => !iso || a.getTime() === Date.parse(iso);

/**
 * The jobs queued before reminder offsets existed, still pending when this
 * code deploys: their stage or template, read as the offset it stood for.
 * Nothing queues these any more.
 */
const LEGACY_OFFSET = { day: 1440, hour: 60, "reminder-day": 1440, "reminder-hour": 60 } as const;

/**
 * How far before a reminder's own moment (start minus offset) a send must
 * be to count as one for an earlier start. A fanout never runs before its
 * runAt, so its own sends are never earlier than that; the minute's slack
 * covers clock skew between the app and the database.
 */
const EARLIER_START_SLACK_MS = 60_000;

/** Whether a reminder at `offset` still applies to the event as it now is. */
function reminderStillDue(
  event: {
    startsAt: Date;
    allDay: boolean;
    deletedAt: Date | null;
    mergedIntoId?: string | null;
    /** Nullable in the database, as every array column is: none means no reminders. */
    reminderMinutes: number[] | null;
  },
  offset: number,
  startsAt: string | undefined,
  now: Date,
): boolean {
  // Deleted or merged away; moved (a newer job has the new time); already
  // started (a drain that ran late); an all-day event's reminder under a day
  // (queued before it became all-day); or a time taken off the meeting's
  // reminders since this was queued.
  return (
    !event.deletedAt &&
    !event.mergedIntoId &&
    sameInstant(event.startsAt, startsAt) &&
    now < event.startsAt &&
    !(event.allDay && offset < ALL_DAY_MIN_REMINDER_MINUTES) &&
    (event.reminderMinutes ?? []).includes(offset)
  );
}

/**
 * The in-app reminder a member gets. Plain text: the title says how far
 * off it is, and the body has the when, the place and, for an online or
 * hybrid meeting with a link, the join link. Never the host link
 * (conferenceHostUrl starts the meeting as its host), which is why the
 * fanout does not even read it.
 */
export function memberReminder(
  event: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    allDay: boolean;
    location: string | null;
    format: MeetingFormat;
    conferenceUrl: string | null;
  },
  offset: number,
  timeZone: string,
): { title: string; body: string } {
  const lead = reminderLead(offset);
  const title =
    lead === "tomorrow" ? `${event.title} is tomorrow` : `${event.title} starts ${lead}`;
  const lines = [whenLine(event.startsAt, event.endsAt, timeZone, event.allDay)];
  const where = event.location?.trim();
  if (where) lines.push(`Where: ${where}`);
  const online = event.format === MeetingFormat.ONLINE || event.format === MeetingFormat.HYBRID;
  if (online && event.conferenceUrl) lines.push(`Join: ${event.conferenceUrl}`);
  return { title, body: lines.join("\n") };
}

/** "cancelled": tells everyone still signed up that the deleted event is off. */
async function fanOutCancellation(db: Db, orgId: string, eventId: string): Promise<number> {
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: orgId },
    select: { deletedAt: true },
  });
  if (!event?.deletedAt) return 0;
  const signedUp = await db.eventRegistration.findMany({
    where: { organizationId: orgId, eventId, status: { in: ["GOING", "WAITLIST"] } },
    select: { id: true },
  });
  return enqueueRsvpEmails(
    db,
    orgId,
    signedUp.map((r) => r.id),
    "event-cancelled",
  );
}

/**
 * One reminder offset of one meeting: an rsvp-email to each guest going
 * (the email job claims its own send), and an in-app EVENT_REMINDER to each
 * member invited who did not decline (claimed here). Returns how many it
 * reached.
 */
async function fanOutReminder(
  db: Db,
  orgId: string,
  eventId: string,
  offset: number,
  startsAt: string | undefined,
): Promise<number> {
  const now = new Date();
  const event = await db.event.findFirst({
    where: { id: eventId, organizationId: orgId },
    // conferenceHostUrl is left out on purpose: see memberReminder.
    select: {
      title: true,
      startsAt: true,
      endsAt: true,
      allDay: true,
      deletedAt: true,
      mergedIntoId: true,
      rsvpEnabled: true,
      reminderMinutes: true,
      location: true,
      format: true,
      conferenceUrl: true,
      organization: { select: { slug: true, timezone: true } },
    },
  });
  if (!event || !reminderStillDue(event, offset, startsAt, now)) return 0;

  // Sends for this offset made before this start's moment were for an
  // earlier start: forget them, so a moved meeting reminds everyone again.
  const due = event.startsAt.getTime() - offset * 60_000;
  await db.eventReminderSend.deleteMany({
    where: {
      organizationId: orgId,
      eventId,
      offsetMinutes: offset,
      sentAt: { lt: new Date(due - EARLIER_START_SLACK_MS) },
    },
  });

  let reached = 0;
  if (event.rsvpEnabled) {
    const going = await db.eventRegistration.findMany({
      where: {
        organizationId: orgId,
        eventId,
        status: "GOING",
        reminderSends: { none: { offsetMinutes: offset, channel: "email" } },
      },
      select: { id: true },
    });
    reached += await enqueueRsvpEmails(
      db,
      orgId,
      going.map((r) => r.id),
      "reminder",
      { startsAt: event.startsAt, offsetMinutes: offset },
    );
  }

  const invited = (
    await db.eventAttendee.findMany({
      where: { organizationId: orgId, eventId, rsvp: { not: "NO" } },
      select: { userId: true },
    })
  ).map((a) => a.userId);
  if (invited.length === 0) return reached;
  // Members only: an invitation outlives a membership, and someone who
  // left the organization hears nothing more from it.
  const members = new Set(
    (
      await db.membership.findMany({
        where: { organizationId: orgId, userId: { in: invited } },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );
  const reminded = new Set(
    (
      await db.eventReminderSend.findMany({
        where: {
          organizationId: orgId,
          eventId,
          offsetMinutes: offset,
          channel: "app",
          userId: { in: invited },
        },
        select: { userId: true },
      })
    ).map((r) => r.userId),
  );
  const recipients = invited.filter((id) => members.has(id) && !reminded.has(id));
  if (recipients.length === 0) return reached;

  // The claim and the notification commit together, and the notification's
  // dedupe key (per start) stops a fanout racing this one from adding a
  // second.
  await db.eventReminderSend.createMany({
    data: recipients.map((userId) => ({
      organizationId: orgId,
      eventId,
      offsetMinutes: offset,
      userId,
      recipientKey: `u:${userId}`,
      channel: "app",
      sentAt: now,
    })),
    skipDuplicates: true,
  });
  const startMinute = Math.floor(event.startsAt.getTime() / 60_000);
  await notifyUsers(db, orgId, recipients, {
    type: NotificationType.EVENT_REMINDER,
    ...memberReminder(event, offset, safeTimeZone(event.organization.timezone)),
    linkUrl: `/app/${event.organization.slug}/meetings/${eventId}`,
    dedupeKey: `event-reminder:${eventId}:${offset}:${startMinute}`,
  });
  return reached + recipients.length;
}

/**
 * rsvp-fanout:{eventId}:r{offset}:{startMinute}: one reminder offset, to
 * members and guests (fanOutReminder); rsvp-fanout:{eventId}:cancelled:
 * the deleted event's cancellation to every guest signed up. The guests'
 * emails are queued in bulk (enqueueRsvpEmails), not a round trip each.
 */
export const rsvpFanoutJob: JobHandler<{
  eventId: string;
  stage: "day" | "hour" | "reminder" | "cancelled";
  offsetMinutes?: number;
  startsAt?: string;
}> = async (run) => {
  const orgId = requireOrg(run.organizationId);
  const { eventId, stage, startsAt } = run.payload;
  let reached: number;
  if (stage === "cancelled") {
    reached = await withSystemOrgTx(orgId, ({ db }) => fanOutCancellation(db, orgId, eventId));
  } else {
    const offset = stage === "reminder" ? run.payload.offsetMinutes : LEGACY_OFFSET[stage];
    if (!offset) throw new PermanentJobError("a reminder fanout names its offset");
    reached = await withSystemOrgTx(orgId, ({ db }) =>
      fanOutReminder(db, orgId, eventId, offset, startsAt),
    );
  }
  if (reached === 0) return { status: "DONE" };
};

type RsvpEmailPayload = {
  registrationId: string;
  template: RsvpEmailTemplate | "reminder-day" | "reminder-hour";
  offsetMinutes?: number;
  startsAt?: string;
};

/** The template to send, with a legacy reminder read as "reminder" at its offset. */
function readTemplate(payload: RsvpEmailPayload): {
  template: RsvpEmailTemplate;
  offset: number | null;
} {
  if (payload.template === "reminder-day" || payload.template === "reminder-hour") {
    return { template: "reminder", offset: LEGACY_OFFSET[payload.template] };
  }
  return {
    template: payload.template,
    offset: payload.template === "reminder" ? (payload.offsetMinutes ?? null) : null,
  };
}

/** rsvp-email:{registrationId}:{template}[...]: one email (and, for reminders, a text). */
export const rsvpEmailJob: JobHandler<RsvpEmailPayload> = async (
  run,
): Promise<JobOutcome | void> => {
  const orgId = requireOrg(run.organizationId);
  const { registrationId, startsAt } = run.payload;
  const { template, offset } = readTemplate(run.payload);
  if (template === "reminder" && !offset) {
    throw new PermanentJobError("a reminder email names its offset");
  }
  /** A reminder's once-only guard: this guest, at this offset, by email. */
  const claimOf = (eventId: string, offsetMinutes: number) => ({
    organizationId: orgId,
    eventId,
    offsetMinutes,
    channel: "email",
    recipientKey: `g:${registrationId}`,
  });

  const loaded = await withSystemOrgTx(orgId, async ({ db }) => {
    const reg = await db.eventRegistration.findFirst({
      where: { id: registrationId, organizationId: orgId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        inviteCode: true,
        ticketCode: true,
        paidClaimedAt: true,
        paidConfirmedAt: true,
        eventId: true,
        event: {
          select: {
            title: true,
            rsvpCostMode: true,
            rsvpCostCents: true,
            rsvpPayTo: true,
            startsAt: true,
            endsAt: true,
            allDay: true,
            location: true,
            locationDetails: true,
            rsvpHideLocation: true,
            // The join link only; never conferenceHostUrl (the host link).
            conferenceProvider: true,
            conferenceUrl: true,
            deletedAt: true,
            mergedIntoId: true,
            rsvpEnabled: true,
            rsvpSlug: true,
            reminderMinutes: true,
            organization: { select: { name: true, timezone: true } },
          },
        },
      },
    });
    if (!reg || !reg.event.rsvpSlug) return null;
    const e = reg.event;
    // Only what is still true goes out: a guest who has since cancelled, or
    // moved off the waitlist, or an event that moved, gets nothing stale,
    // and a reminder still waiting when the event starts (a retry, a late
    // drain) is dropped rather than sent during or after it.
    const stillTrue =
      template === "event-cancelled"
        ? Boolean(e.deletedAt) && reg.status !== "CANCELLED"
        : !e.deletedAt &&
          (template === "waitlisted" ? reg.status === "WAITLIST" : reg.status === "GOING") &&
          (!offset || (e.rsvpEnabled && reminderStillDue(e, offset, startsAt, new Date())));
    if (!stillTrue) return null;
    if (offset) {
      // Claim it, so a re-run after a lost lease, or a second fanout, doesn't
      // remind twice: a row already there means it went out.
      const claimed = await db.eventReminderSend.createMany({
        data: [{ ...claimOf(reg.eventId, offset), registrationId: reg.id, sentAt: new Date() }],
        skipDuplicates: true,
      });
      if (claimed.count === 0) return null;
    }
    const { going } = await registrationCounts(db, orgId, reg.eventId);
    return { ...reg, going };
  });
  if (!loaded) return { status: "DONE" };

  const e = loaded.event;
  const tz = safeTimeZone(e.organization.timezone);
  const message = {
    template,
    ...(offset ? { offsetMinutes: offset } : {}),
    guestName: loaded.name,
    orgName: e.organization.name,
    title: e.title,
    when: whenLine(e.startsAt, e.endsAt, tz, e.allDay),
    startTime: startTime(e.startsAt, tz),
    // The same rule as the page: the join link only for someone going, and
    // an address the host hides only for someone going too.
    ...guestPlace(
      {
        location: e.location,
        locationDetails: e.locationDetails,
        hideLocation: e.rsvpHideLocation,
        joinUrl: e.conferenceProvider !== "NONE" ? e.conferenceUrl : null,
      },
      loaded.status === "GOING",
    ),
    pageUrl: appUrl(`/e/${e.rsvpSlug}/manage?key=${encodeURIComponent(rsvpManageKey(loaded.id))}`),
    ...guestLinks(loaded, e.rsvpSlug!, template),
  };

  try {
    // The club's own sender, else "<Club> via Bananasplit": a guest's
    // confirmation and reminders go out either way, like invitations.
    const mailer = (await getOrgMailer(orgId)) ?? platformFallbackMailer(e.organization.name);
    await mailer.send({ to: loaded.email, ...rsvpEmail(message) }, { signal: run.signal });
  } catch (error) {
    if (offset) {
      // Release the claim so the retry sends it.
      await withSystemOrgTx(orgId, ({ db }) =>
        db.eventReminderSend.deleteMany({ where: claimOf(loaded.eventId, offset) }),
      );
    }
    throw error;
  }

  // The text is best effort: the email already went, and retrying the job
  // for a refused or flaky text would send that email again.
  const text = rsvpText(message);
  if (text && smsDelivery() !== "off") {
    await sendSms(loaded.phone, text, { signal: run.signal }).catch((error: unknown) => {
      const reason = error instanceof SmsSendError ? error.message : "send failed";
      console.warn(`[rsvp] reminder text not sent: ${reason}`);
    });
  }
};

/**
 * The ticket, the invite link and what to chip in, for the emails that go
 * to someone who is going (not the waitlist, not a cancellation).
 */
function guestLinks(
  reg: {
    status: string;
    inviteCode: string;
    ticketCode: string;
    paidClaimedAt: Date | null;
    paidConfirmedAt: Date | null;
    going: number;
    name: string;
    event: {
      title: string;
      rsvpCostMode: "NONE" | "EACH" | "SPLIT";
      rsvpCostCents: number | null;
      rsvpPayTo: unknown;
    };
  },
  slug: string,
  template: RsvpEmailTemplate,
): { ticketUrl: string | null; inviteUrl: string | null; chipIn: string | null } {
  const going = reg.status === "GOING" && template !== "event-cancelled";
  if (!going) return { ticketUrl: null, inviteUrl: null, chipIn: null };
  const share = shareCents(reg.event.rsvpCostMode, reg.event.rsvpCostCents, reg.going);
  const paid = Boolean(reg.paidClaimedAt || reg.paidConfirmedAt);
  let chipIn: string | null = null;
  if (share !== null && !paid) {
    const ways = payLinks(parsePayTo(reg.event.rsvpPayTo), share, reg.event.title)
      .map((l) => `${l.label} ${l.detail ?? ""}`.trim())
      .join(", ");
    chipIn = `${formatCents(share)}${reg.event.rsvpCostMode === "SPLIT" ? " (your share right now)" : ""} to the host${ways ? `: ${ways}` : ""}`;
  }
  return {
    ticketUrl: appUrl(`/e/${slug}/t/${reg.ticketCode}`),
    inviteUrl:
      template === "registered" || template === "promoted"
        ? appUrl(`/e/${slug}?via=${reg.inviteCode}`)
        : null,
    chipIn,
  };
}
