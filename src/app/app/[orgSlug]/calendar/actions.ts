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
import { withOrgAction, type OrgContext } from "@/server/db/context";
import * as events from "@/server/events/service";
import { notifyUsers } from "@/server/notifications";

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
  conferenceProvider: z.enum(ConferenceProvider).optional(),
  conferenceUrl: z.string().max(2000).nullish(),
  kind: z.enum(EventKind).optional(),
  visibility: z.enum(EventVisibility).optional(),
  hostUserId: z.string().max(100).nullish(),
  hostName: z.string().max(120).nullish(),
  rsvpUrl: z.string().max(2000).nullish(),
  capacityFull: z.boolean().optional(),
  featured: z.boolean().optional(),
  publicNote: z.string().max(500).nullish(),
  stampSlot: z.number().int().min(1).max(12).nullish(),
  attendeeIds: z.array(z.string().min(1).max(100)).max(200).optional(),
  /** Tell existing attendees about a reschedule, a move or a cancellation (default yes). */
  notifyAttendees: z.boolean().optional(),
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

async function checkAttendees(ctx: OrgContext, attendeeIds: readonly string[]): Promise<string | null> {
  if (attendeeIds.length === 0) return null;
  const count = await ctx.db.membership.count({
    where: { organizationId: ctx.organizationId, userId: { in: [...attendeeIds] } },
  });
  return count === attendeeIds.length ? null : "One or more attendees aren't members of this organization.";
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
  await notifyUsers(ctx.db, ctx.organizationId, recipients, { type, title, linkUrl, actorId: ctx.userId });
}

function serviceFields(data: z.infer<typeof eventPatchSchema>) {
  const out: events.EventPatch = {};
  if (data.title !== undefined) out.title = data.title;
  if (data.description !== undefined) out.description = data.description;
  if (data.location !== undefined) out.location = data.location;
  if (data.conferenceProvider !== undefined) out.conferenceProvider = data.conferenceProvider;
  if (data.conferenceUrl !== undefined) out.conferenceUrl = data.conferenceUrl;
  if (data.kind !== undefined) out.kind = data.kind;
  if (data.visibility !== undefined) out.visibility = data.visibility;
  if (data.hostUserId !== undefined) out.hostUserId = data.hostUserId || null;
  if (data.hostName !== undefined) out.hostName = data.hostName;
  if (data.rsvpUrl !== undefined) out.rsvpUrl = data.rsvpUrl?.trim() || null;
  if (data.capacityFull !== undefined) out.capacityFull = data.capacityFull;
  if (data.featured !== undefined) out.featured = data.featured;
  if (data.publicNote !== undefined) out.publicNote = data.publicNote;
  if (data.stampSlot !== undefined) out.stampSlot = data.stampSlot;
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

  const { event } = await events.createEvent(ctx, {
    ...serviceFields(data),
    title: data.title,
    conferenceProvider: provider,
    ...times,
  });
  if (attendeeIds.length > 0) {
    await ctx.db.eventAttendee.createMany({
      data: attendeeIds.map((userId) => ({ organizationId: ctx.organizationId, eventId: event.id, userId })),
      skipDuplicates: true,
    });
    await notify(
      ctx,
      attendeeIds,
      NotificationType.EVENT_INVITE,
      `You were invited to "${event.title}"`,
      eventLink(org.slug, event.id),
    );
  }
  return { eventId: event.id };
});

/** Creates an event (ADMIN+). */
export async function createEvent(organizationId: string, input: EventFormInput): Promise<ActionResult> {
  try {
    return await createEventTx(organizationId, input);
  } catch (error) {
    return actionError(error);
  }
}

const updateEventTx = withOrgAction(
  async (ctx, eventId: string, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "events.write");
    const parsed = eventPatchSchema.safeParse(input);
    if (!parsed.success) return { error: firstIssue(parsed.error) };
    const data = parsed.data;
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
      const times = resolveTimes(data.allDay ?? before.allDay, data.startsAt, data.endsAt, org.timezone);
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
    const link = eventLink(org.slug, eventId);
    await notify(ctx, added, NotificationType.EVENT_INVITE, `You were invited to "${event.title}"`, link);
    const rescheduled =
      event.startsAt.getTime() !== before.startsAt.getTime() ||
      event.endsAt.getTime() !== before.endsAt.getTime() ||
      event.allDay !== before.allDay ||
      (event.location ?? "") !== (before.location ?? "");
    if (rescheduled && data.notifyAttendees !== false) {
      await notify(ctx, [...previous], NotificationType.EVENT_UPDATED, `"${event.title}" changed time or place`, link);
    }
    return { eventId };
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
  async (ctx, eventId: string, opts: { notifyAttendees?: boolean } = {}): Promise<ActionResult> => {
    requirePermission(ctx, "events.write");
    const attendees = await ctx.db.eventAttendee.findMany({
      where: { organizationId: ctx.organizationId, eventId },
      select: { userId: true },
    });
    const { event } = await events.deleteEvent(ctx, eventId);
    if (opts.notifyAttendees !== false) {
      const org = await orgInfo(ctx);
      await notify(
        ctx,
        attendees.map((a) => a.userId),
        NotificationType.EVENT_CANCELLED,
        `"${event.title}" was cancelled`,
        `/app/${org.slug}/calendar`,
      );
    }
    return {};
  },
);

/** Deletes (soft) an event (ADMIN+); its Google mirror goes in the gcal job. */
export async function deleteEvent(
  organizationId: string,
  eventId: string,
  opts: { notifyAttendees?: boolean } = {},
): Promise<ActionResult> {
  try {
    return await deleteEventTx(organizationId, eventId, opts);
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
export async function rsvpToEvent(organizationId: string, eventId: string, rsvp: RSVPStatus): Promise<ActionResult> {
  try {
    return await rsvpTx(organizationId, eventId, rsvp);
  } catch (error) {
    return actionError(error);
  }
}
