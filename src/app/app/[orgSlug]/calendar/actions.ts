"use server";

import { z } from "zod";

import {
  ConferenceProvider,
  EventKind,
  EventVisibility,
  NotificationType,
  RSVPStatus,
} from "@/generated/prisma/client";
import { requirePermission } from "@/lib/auth/permissions";
import { conferenceUrlError, resolveTimes } from "@/lib/calendar/event-input";
import { MAX_REMINDERS } from "@/lib/meetings/reminders";
import { weeklyOccurrences, weeksAfterKey } from "@/lib/meetings/series";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import * as events from "@/server/events/service";
import { notifyUsers } from "@/server/notifications";
import { notifyEventCancelled, scheduleEventReminders } from "@/server/rsvp/service";

import { actionError } from "./action-result";

/**
 * Calendar Server Actions. Every write goes through the event service
 * (src/server/events/service.ts): ADMIN+ only, validated, audited, the
 * Google mirror and the website rebuild queued, and the public feed's cache
 * invalidated after commit (updateTag, since these are Server Actions).
 * Attendees and their notifications are the calendar's own concern and
 * happen in the same transaction.
 *
 * Times: timed events arrive as ISO instants (the browser converts its
 * local wall time); all-day events arrive as the first and LAST day
 * ("YYYY-MM-DD") and are stored as org-timezone midnights with an exclusive
 * end. Each action returns { error } rather than throwing.
 */

export interface ActionResult {
  error?: string;
  eventId?: string;
}

const eventFormSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(20_000).nullish(),
  allDay: z.boolean().default(false),
  startsAt: z.string().min(1).max(40),
  endsAt: z.string().min(1).max(40),
  location: z.string().max(300).nullish(),
  /** How to find the place. The sign-up page's settings write it too, with the same cap. */
  locationDetails: z.string().max(1000).nullish(),
  conferenceProvider: z.enum(ConferenceProvider).optional(),
  conferenceUrl: z.string().max(2000).nullish(),
  kind: z.enum(EventKind).optional(),
  /** One of the org's meeting types, by name (the form sends it; it used to be dropped here). */
  meetingType: z.string().max(40).nullish(),
  visibility: z.enum(EventVisibility).optional(),
  hostUserId: z.string().max(100).nullish(),
  hostName: z.string().max(120).nullish(),
  rsvpUrl: z.string().max(2000).nullish(),
  capacityFull: z.boolean().optional(),
  featured: z.boolean().optional(),
  publicNote: z.string().max(500).nullish(),
  stampSlot: z.number().int().min(1).max(12).nullish(),
  /** Minutes before the start to remind people. The service validates the range and duplicates; left out, a new event takes the organization's default. */
  reminderMinutes: z
    .array(z.number().int())
    .max(MAX_REMINDERS, `Use at most ${MAX_REMINDERS} reminders.`)
    .optional(),
  attendeeIds: z.array(z.string().min(1).max(100)).max(200).optional(),
  /** Tell existing attendees about a reschedule, a move or a cancellation (default yes). */
  notifyAttendees: z.boolean().optional(),
  /** Create only: repeat weekly through this day (YYYY-MM-DD, the org's zone), a linked series. */
  repeatWeeklyUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  /** Edit only, on a series: this meeting, or this and the ones after. */
  scope: z.enum(["one", "following"]).optional(),
});

const eventPatchSchema = eventFormSchema.partial().extend({ allDay: z.boolean().optional() });

export type EventFormInput = z.input<typeof eventFormSchema>;
export type EventFormPatch = z.input<typeof eventPatchSchema>;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}

interface OrgInfo {
  slug: string;
  timezone: string;
}

async function orgInfo(ctx: OrgContext): Promise<OrgInfo> {
  const org = await ctx.db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { slug: true, timezone: true },
  });
  return { slug: org?.slug ?? "", timezone: org?.timezone ?? "UTC" };
}

async function checkAttendees(
  ctx: OrgContext,
  attendeeIds: readonly string[],
): Promise<string | null> {
  if (attendeeIds.length === 0) return null;
  const count = await ctx.db.membership.count({
    where: { organizationId: ctx.organizationId, userId: { in: [...attendeeIds] } },
  });
  return count === attendeeIds.length
    ? null
    : "One or more attendees aren't members of this organization.";
}

function eventLink(slug: string, eventId: string): string {
  return `/app/${slug}/calendar/${eventId}`;
}

async function notify(
  ctx: OrgContext,
  userIds: readonly string[],
  type: NotificationType,
  title: string,
  linkUrl: string | null,
): Promise<void> {
  const recipients = userIds.filter((id) => id !== ctx.userId);
  if (recipients.length === 0) return;
  await notifyUsers(ctx.db, ctx.organizationId, recipients, {
    type,
    title,
    linkUrl,
    actorId: ctx.userId,
  });
}

function serviceFields(data: z.infer<typeof eventPatchSchema>) {
  const out: events.EventPatch = {};
  if (data.title !== undefined) out.title = data.title;
  if (data.description !== undefined) out.description = data.description;
  if (data.location !== undefined) out.location = data.location;
  if (data.locationDetails !== undefined) out.locationDetails = data.locationDetails;
  if (data.conferenceProvider !== undefined) out.conferenceProvider = data.conferenceProvider;
  if (data.conferenceUrl !== undefined) out.conferenceUrl = data.conferenceUrl;
  if (data.kind !== undefined) out.kind = data.kind;
  if (data.meetingType !== undefined) out.meetingType = data.meetingType?.trim() || null;
  if (data.visibility !== undefined) out.visibility = data.visibility;
  if (data.hostUserId !== undefined) out.hostUserId = data.hostUserId || null;
  if (data.hostName !== undefined) out.hostName = data.hostName;
  if (data.rsvpUrl !== undefined) out.rsvpUrl = data.rsvpUrl?.trim() || null;
  if (data.capacityFull !== undefined) out.capacityFull = data.capacityFull;
  if (data.featured !== undefined) out.featured = data.featured;
  if (data.publicNote !== undefined) out.publicNote = data.publicNote;
  if (data.stampSlot !== undefined) out.stampSlot = data.stampSlot;
  if (data.reminderMinutes !== undefined) out.reminderMinutes = data.reminderMinutes;
  return out;
}

const createEventTx = withOrgAction(async (ctx, input: unknown): Promise<ActionResult> => {
  requirePermission(ctx, "events.write");
  const parsed = eventFormSchema.safeParse(input);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const data = parsed.data;
  const provider = data.conferenceProvider ?? ConferenceProvider.NONE;
  const urlError = conferenceUrlError(provider, data.conferenceUrl);
  if (urlError) return { error: urlError };
  const attendeeIds = [...new Set(data.attendeeIds ?? [])];
  const attendeeError = await checkAttendees(ctx, attendeeIds);
  if (attendeeError) return { error: attendeeError };

  const org = await orgInfo(ctx);
  const times = resolveTimes(data.allDay, data.startsAt, data.endsAt, org.timezone);
  if ("error" in times) return times;

  // A repeating meeting is a linked series: one real event per week, each
  // with its own sign-ups, notes and call, sharing a seriesId.
  const weeks = data.repeatWeeklyUntil
    ? weeklyOccurrences(times, data.repeatWeeklyUntil, org.timezone)
    : [{ startsAt: times.startsAt, endsAt: times.endsAt }];
  const fields = { ...serviceFields(data), title: data.title, conferenceProvider: provider };
  const ids: string[] = [];
  let firstTitle = data.title;
  for (const week of weeks) {
    const { event } = await events.createEvent(ctx, { ...fields, ...week, allDay: times.allDay });
    if (ids.length === 0) firstTitle = event.title;
    ids.push(event.id);
  }
  const firstId = ids[0]!;
  if (ids.length > 1) {
    await ctx.db.event.updateMany({
      where: { organizationId: ctx.organizationId, id: { in: ids } },
      data: { seriesId: firstId },
    });
  }
  if (attendeeIds.length > 0) {
    await ctx.db.eventAttendee.createMany({
      data: ids.flatMap((eventId) =>
        attendeeIds.map((userId) => ({ organizationId: ctx.organizationId, eventId, userId })),
      ),
      skipDuplicates: true,
    });
    // One invitation for the whole series, not one per week.
    await notify(
      ctx,
      attendeeIds,
      NotificationType.EVENT_INVITE,
      ids.length > 1
        ? `You were invited to "${firstTitle}" (weekly)`
        : `You were invited to "${firstTitle}"`,
      eventLink(org.slug, firstId),
    );
  }
  return { eventId: firstId };
});

/** Creates an event (ADMIN+). */
export async function createEvent(
  organizationId: string,
  input: EventFormInput,
): Promise<ActionResult> {
  try {
    return await createEventTx(organizationId, input);
  } catch (error) {
    return actionError(error);
  }
}

type EventPatchData = z.infer<typeof eventPatchSchema>;

/** Applies a patch to one event (the body of an edit). */
async function updateOne(
  ctx: OrgContext,
  eventId: string,
  data: EventPatchData,
): Promise<ActionResult> {
  const before = await ctx.db.event.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
    select: {
      title: true,
      allDay: true,
      startsAt: true,
      endsAt: true,
      location: true,
      conferenceProvider: true,
      conferenceUrl: true,
      attendees: { select: { userId: true } },
    },
  });
  if (!before) return { error: "That event no longer exists." };

  const provider = data.conferenceProvider ?? before.conferenceProvider;
  const url = data.conferenceUrl !== undefined ? data.conferenceUrl : before.conferenceUrl;
  if (data.conferenceProvider !== undefined || data.conferenceUrl !== undefined) {
    const urlError = conferenceUrlError(provider, url);
    if (urlError) return { error: urlError };
  }

  const org = await orgInfo(ctx);
  const patch: events.EventPatch = serviceFields(data);
  if (data.startsAt !== undefined || data.endsAt !== undefined || data.allDay !== undefined) {
    if (data.startsAt === undefined || data.endsAt === undefined) {
      return { error: "Send both the start and the end." };
    }
    const times = resolveTimes(
      data.allDay ?? before.allDay,
      data.startsAt,
      data.endsAt,
      org.timezone,
    );
    if ("error" in times) return times;
    Object.assign(patch, times);
  }

  const previous = new Set(before.attendees.map((a) => a.userId));
  let added: string[] = [];
  if (data.attendeeIds) {
    const next = [...new Set(data.attendeeIds)];
    const attendeeError = await checkAttendees(ctx, next);
    if (attendeeError) return { error: attendeeError };
    added = next.filter((id) => !previous.has(id));
    const removed = [...previous].filter((id) => !next.includes(id));
    if (removed.length > 0) {
      await ctx.db.eventAttendee.deleteMany({
        where: { organizationId: ctx.organizationId, eventId, userId: { in: removed } },
      });
    }
    if (added.length > 0) {
      await ctx.db.eventAttendee.createMany({
        data: added.map((userId) => ({ organizationId: ctx.organizationId, eventId, userId })),
        skipDuplicates: true,
      });
    }
    for (const id of removed) previous.delete(id);
  }

  const { event } = await events.updateEvent(ctx, eventId, patch);
  // Someone new to remind. The service queued the reminders only if the
  // time or the offsets changed; an event that came in from the Google
  // import may have none queued yet. Its job keys merge, so queuing again
  // is harmless.
  if (added.length > 0) await scheduleEventReminders(ctx.db, event);
  const link = eventLink(org.slug, eventId);
  await notify(
    ctx,
    added,
    NotificationType.EVENT_INVITE,
    `You were invited to "${event.title}"`,
    link,
  );
  const rescheduled =
    event.startsAt.getTime() !== before.startsAt.getTime() ||
    event.endsAt.getTime() !== before.endsAt.getTime() ||
    event.allDay !== before.allDay ||
    (event.location ?? "") !== (before.location ?? "");
  if (rescheduled && data.notifyAttendees !== false) {
    await notify(
      ctx,
      [...previous],
      NotificationType.EVENT_UPDATED,
      `"${event.title}" changed time or place`,
      link,
    );
  }
  return { eventId };
}

const updateEventTx = withOrgAction(
  async (ctx, eventId: string, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "events.write");
    const parsed = eventPatchSchema.safeParse(input);
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const data = parsed.data;
    const before = await ctx.db.event.findFirst({
      where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
      select: { startsAt: true, seriesId: true },
    });
    const result = await updateOne(ctx, eventId, data);
    if (result.error || data.scope !== "following" || !before?.seriesId) return result;

    // "This and the ones after": the same change to every later week. A
    // time change moves each by the same amount; the people invited hear
    // once, from this one.
    const after = await ctx.db.event.findFirst({
      where: { id: eventId, organizationId: ctx.organizationId },
      select: { startsAt: true, endsAt: true },
    });
    const shift = after ? after.startsAt.getTime() - before.startsAt.getTime() : 0;
    const length = after ? after.endsAt.getTime() - after.startsAt.getTime() : 0;
    const timed = data.startsAt !== undefined || data.endsAt !== undefined;
    const later = await ctx.db.event.findMany({
      where: {
        organizationId: ctx.organizationId,
        seriesId: before.seriesId,
        deletedAt: null,
        startsAt: { gt: before.startsAt },
      },
      orderBy: { startsAt: "asc" },
      select: { id: true, startsAt: true },
    });
    const rest: EventPatchData = { ...data };
    delete rest.startsAt;
    delete rest.endsAt;
    delete rest.scope;
    for (const e of later) {
      const startsAt = new Date(e.startsAt.getTime() + shift);
      const patch: EventPatchData = timed
        ? {
            ...rest,
            startsAt: startsAt.toISOString(),
            endsAt: new Date(startsAt.getTime() + length).toISOString(),
          }
        : rest;
      const r = await updateOne(ctx, e.id, { ...patch, notifyAttendees: false });
      if (r.error) return r;
    }
    return result;
  },
);

/** Updates any subset of an event's fields (ADMIN+). */
export async function updateEvent(
  organizationId: string,
  eventId: string,
  input: EventFormPatch,
): Promise<ActionResult> {
  try {
    return await updateEventTx(organizationId, eventId, input);
  } catch (error) {
    return actionError(error);
  }
}

/**
 * Drag and resize on the grid (ADMIN+). Timed: ISO instants; all-day: the
 * first and last day. Attendees are not notified for a drag.
 */
export async function moveEvent(
  organizationId: string,
  eventId: string,
  times: { allDay: boolean; startsAt: string; endsAt: string },
): Promise<ActionResult> {
  return updateEvent(organizationId, eventId, { ...times, notifyAttendees: false });
}

const deleteEventTx = withOrgAction(
  async (
    ctx,
    eventId: string,
    opts: { notifyAttendees?: boolean; scope?: "one" | "following" } = {},
  ): Promise<ActionResult & { deletedIds?: string[] }> => {
    requirePermission(ctx, "events.write");
    const target = await ctx.db.event.findFirst({
      where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, startsAt: true, seriesId: true },
    });
    if (!target) return { error: "That event no longer exists." };
    const ids =
      opts.scope === "following" && target.seriesId
        ? (
            await ctx.db.event.findMany({
              where: {
                organizationId: ctx.organizationId,
                seriesId: target.seriesId,
                deletedAt: null,
                startsAt: { gte: target.startsAt },
              },
              select: { id: true },
            })
          ).map((e) => e.id)
        : [target.id];
    for (const id of ids) {
      await events.deleteEvent(ctx, id);
      // Nobody is told at once: the notice waits out the Undo window and
      // goes only if the event is still deleted then (restoreEvents).
      await notifyEventCancelled(ctx.db, ctx.organizationId, id, {
        notifyMembers: opts.notifyAttendees !== false,
        actorId: ctx.userId,
      });
    }
    return { deletedIds: ids };
  },
);

/**
 * Deletes (soft) an event, or a series from this week on (ADMIN+); its
 * Google mirror goes in the gcal job. Returns what it deleted, for Undo.
 */
export async function deleteEvent(
  organizationId: string,
  eventId: string,
  opts: { notifyAttendees?: boolean; scope?: "one" | "following" } = {},
): Promise<ActionResult & { deletedIds?: string[] }> {
  try {
    return await deleteEventTx(organizationId, eventId, opts);
  } catch (error) {
    return actionError(error);
  }
}

const restoreEventsTx = withOrgAction(async (ctx, ids: unknown): Promise<ActionResult> => {
  requirePermission(ctx, "events.write");
  const parsed = z.array(z.string().min(1).max(100)).max(60).safeParse(ids);
  if (!parsed.success) return { error: "Nothing to put back." };
  // Back as it was. The cancellation notice queued by the delete finds it
  // live and sends nothing; an empty save re-queues its Google mirror and
  // its reminders.
  await ctx.db.event.updateMany({
    where: {
      organizationId: ctx.organizationId,
      id: { in: parsed.data },
      deletedAt: { not: null },
    },
    data: { deletedAt: null },
  });
  for (const id of parsed.data) {
    const live = await ctx.db.event.findFirst({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (live) await events.updateEvent(ctx, id, {});
  }
  return {};
});

/** Undo for deleteEvent: puts the events back (ADMIN+). */
export async function restoreEvents(organizationId: string, ids: string[]): Promise<ActionResult> {
  try {
    return await restoreEventsTx(organizationId, ids);
  } catch (error) {
    return actionError(error);
  }
}

const extendSeriesTx = withOrgAction(
  async (ctx, eventId: string, weeks: unknown): Promise<ActionResult & { added?: number }> => {
    requirePermission(ctx, "events.write");
    const count = z.number().int().min(1).max(26).safeParse(weeks);
    if (!count.success) return { error: "Add between 1 and 26 weeks." };
    const anchor = await ctx.db.event.findFirst({
      where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, seriesId: true },
    });
    if (!anchor) return { error: "That event no longer exists." };
    const seriesId = anchor.seriesId ?? anchor.id;
    // The new weeks follow on from the last week there is.
    const last = await ctx.db.event.findFirst({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        OR: [{ seriesId }, { id: anchor.id }],
      },
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        startsAt: true,
        endsAt: true,
        allDay: true,
        location: true,
        locationDetails: true,
        conferenceProvider: true,
        conferenceUrl: true,
        conferenceManaged: true,
        kind: true,
        meetingType: true,
        visibility: true,
        hostUserId: true,
        hostName: true,
        reminderMinutes: true,
        attendees: { select: { userId: true } },
      },
    });
    if (!last) return { error: "That event no longer exists." };
    const org = await orgInfo(ctx);
    const next = weeklyOccurrences(
      last,
      weeksAfterKey(last.startsAt, count.data, org.timezone),
      org.timezone,
    ).slice(1);
    const ids: string[] = [];
    for (const week of next) {
      const { event } = await events.createEvent(ctx, {
        title: last.title,
        description: last.description,
        allDay: last.allDay,
        location: last.location,
        locationDetails: last.locationDetails,
        conferenceProvider: last.conferenceProvider,
        // A call we make is made again for each week; a pasted link carries over.
        conferenceUrl: last.conferenceManaged ? null : last.conferenceUrl,
        kind: last.kind,
        meetingType: last.meetingType,
        visibility: last.visibility,
        hostUserId: last.hostUserId,
        hostName: last.hostName,
        reminderMinutes: last.reminderMinutes,
        ...week,
      });
      ids.push(event.id);
    }
    await ctx.db.event.updateMany({
      where: { organizationId: ctx.organizationId, id: { in: [...ids, anchor.id, last.id] } },
      data: { seriesId },
    });
    if (last.attendees.length > 0 && ids.length > 0) {
      await ctx.db.eventAttendee.createMany({
        data: ids.flatMap((id) =>
          last.attendees.map((a) => ({
            organizationId: ctx.organizationId,
            eventId: id,
            userId: a.userId,
          })),
        ),
        skipDuplicates: true,
      });
    }
    return { eventId: anchor.id, added: ids.length };
  },
);

/** Adds weeks after a repeating meeting's last one, or makes a one-off repeat (ADMIN+). */
export async function extendSeries(
  organizationId: string,
  eventId: string,
  weeks: number,
): Promise<ActionResult & { added?: number }> {
  try {
    return await extendSeriesTx(organizationId, eventId, weeks);
  } catch (error) {
    return actionError(error);
  }
}

const rsvpTx = withOrgAction(async (ctx, eventId: string, rsvp: unknown): Promise<ActionResult> => {
  const parsed = z.enum(RSVPStatus).safeParse(rsvp);
  if (!parsed.success) return { error: "Invalid RSVP value." };
  // Only the caller's own invitation row.
  const updated = await ctx.db.eventAttendee.updateMany({
    where: { organizationId: ctx.organizationId, eventId, userId: ctx.userId },
    data: { rsvp: parsed.data },
  });
  if (updated.count === 0) return { error: "You aren't invited to this event." };
  return {};
});

/** Any member answers their own invitation. */
export async function rsvpToEvent(
  organizationId: string,
  eventId: string,
  rsvp: RSVPStatus,
): Promise<ActionResult> {
  try {
    return await rsvpTx(organizationId, eventId, rsvp);
  } catch (error) {
    return actionError(error);
  }
}
