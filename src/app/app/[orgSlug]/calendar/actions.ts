"use server";

import { z } from "zod";

import { ConferenceProvider, NotificationType, RSVPStatus } from "@/generated/prisma/client";
import { withOrgContext } from "@/lib/auth/with-org-context";
import { notifyUser } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

async function notifyEventInvitees(
  organizationId: string,
  eventTitle: string,
  attendeeIds: string[],
) {
  if (attendeeIds.length === 0) return;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  });
  await Promise.all(
    attendeeIds.map((userId) =>
      notifyUser({
        organizationId,
        userId,
        type: NotificationType.EVENT_INVITE,
        title: `You were invited to "${eventTitle}"`,
        linkUrl: org ? `/app/${org.slug}/calendar` : undefined,
      }),
    ),
  );
}

const CONFERENCE_PROVIDER_VALUES = Object.values(ConferenceProvider) as [
  ConferenceProvider,
  ...ConferenceProvider[],
];
const RSVP_VALUES = Object.values(RSVPStatus) as [RSVPStatus, ...RSVPStatus[]];

/**
 * Paste-only validation per provider (no auto-generated links in v1).
 * `Other` accepts any https URL; `None` requires the field to be empty.
 */
function validateConferenceUrl(provider: ConferenceProvider, url: string | null | undefined) {
  const trimmed = url?.trim() || "";

  if (provider === ConferenceProvider.NONE) {
    return trimmed ? "Remove the link or choose a conferencing provider." : null;
  }
  if (!trimmed) {
    return "Paste a meeting link for this provider.";
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That doesn't look like a valid URL.";
  }
  if (parsed.protocol !== "https:") {
    return "Meeting links must use https.";
  }

  switch (provider) {
    case ConferenceProvider.MEET:
      return parsed.hostname === "meet.google.com" ? null : "Expected a meet.google.com link.";
    case ConferenceProvider.ZOOM:
      return parsed.hostname.endsWith("zoom.us") ? null : "Expected a zoom.us link.";
    case ConferenceProvider.TEAMS:
      return parsed.hostname === "teams.microsoft.com"
        ? null
        : "Expected a teams.microsoft.com link.";
    case ConferenceProvider.OTHER:
      return null;
    default:
      return null;
  }
}

const eventInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(20_000).nullable().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  allDay: z.boolean().optional(),
  location: z.string().max(300).nullable().optional(),
  conferenceProvider: z.enum(CONFERENCE_PROVIDER_VALUES).optional(),
  conferenceUrl: z.string().max(2000).nullable().optional(),
  attendeeIds: z.array(z.string()).max(200).optional(),
});

export type EventInput = z.infer<typeof eventInputSchema>;

interface ActionResult {
  error?: string;
  eventId?: string;
}

async function assertAttendeesAreMembers(organizationId: string, attendeeIds?: string[]) {
  if (!attendeeIds?.length) return null;
  const count = await prisma.membership.count({
    where: { organizationId, userId: { in: attendeeIds } },
  });
  if (count !== new Set(attendeeIds).size) {
    return "One or more attendees aren't members of this organization.";
  }
  return null;
}

export const createEvent = withOrgContext(async (ctx, input: unknown): Promise<ActionResult> => {
  const parsed = eventInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const provider = data.conferenceProvider ?? ConferenceProvider.NONE;
  const urlError = validateConferenceUrl(provider, data.conferenceUrl);
  if (urlError) return { error: urlError };

  const attendeeError = await assertAttendeesAreMembers(ctx.organizationId, data.attendeeIds);
  if (attendeeError) return { error: attendeeError };

  const startsAt = new Date(data.startsAt);
  const endsAt = new Date(data.endsAt);
  if (endsAt < startsAt) {
    return { error: "End time must be after the start time." };
  }

  const event = await prisma.event.create({
    data: {
      organizationId: ctx.organizationId,
      title: data.title,
      description: data.description ?? null,
      startsAt,
      endsAt,
      allDay: data.allDay ?? false,
      location: data.location ?? null,
      conferenceProvider: provider,
      conferenceUrl: provider === ConferenceProvider.NONE ? null : (data.conferenceUrl ?? null),
      createdById: ctx.user.id,
      attendees: data.attendeeIds?.length
        ? { create: data.attendeeIds.map((userId) => ({ userId })) }
        : undefined,
    },
    include: { attendees: { include: { user: true } } },
  });

  const inviteeIds = event.attendees
    .map((a) => a.userId)
    .filter((userId) => userId !== ctx.user.id);
  await notifyEventInvitees(ctx.organizationId, event.title, inviteeIds);

  return { eventId: event.id };
});

export const updateEvent = withOrgContext(
  async (ctx, eventId: string, input: unknown): Promise<ActionResult> => {
    const existing = await prisma.event.findFirst({
      where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
      include: { attendees: true },
    });
    if (!existing) {
      return { error: "Event not found." };
    }

    const parsed = eventInputSchema.partial().safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    const provider = data.conferenceProvider ?? existing.conferenceProvider;
    const urlValue = data.conferenceUrl !== undefined ? data.conferenceUrl : existing.conferenceUrl;
    const urlError = validateConferenceUrl(provider, urlValue);
    if (urlError) return { error: urlError };

    const attendeeError = await assertAttendeesAreMembers(ctx.organizationId, data.attendeeIds);
    if (attendeeError) return { error: attendeeError };

    const startsAt = data.startsAt ? new Date(data.startsAt) : existing.startsAt;
    const endsAt = data.endsAt ? new Date(data.endsAt) : existing.endsAt;
    if (endsAt < startsAt) {
      return { error: "End time must be after the start time." };
    }

    const previousAttendeeIds = new Set(existing.attendees.map((a) => a.userId));

    await prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: {
          title: data.title,
          description: data.description,
          startsAt: data.startsAt ? startsAt : undefined,
          endsAt: data.endsAt ? endsAt : undefined,
          allDay: data.allDay,
          location: data.location,
          conferenceProvider: data.conferenceProvider,
          conferenceUrl: provider === ConferenceProvider.NONE ? null : urlValue,
        },
      });

      if (data.attendeeIds) {
        await tx.eventAttendee.deleteMany({ where: { eventId } });
        if (data.attendeeIds.length) {
          await tx.eventAttendee.createMany({
            data: data.attendeeIds.map((userId) => ({ userId, eventId })),
          });
        }
      }
    });

    if (data.attendeeIds) {
      const newAttendeeIds = data.attendeeIds.filter(
        (id) => !previousAttendeeIds.has(id) && id !== ctx.user.id,
      );
      await notifyEventInvitees(ctx.organizationId, data.title ?? existing.title, newAttendeeIds);
    }

    return { eventId };
  },
);

export const deleteEvent = withOrgContext(async (ctx, eventId: string): Promise<ActionResult> => {
  const existing = await prisma.event.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
  });
  if (!existing) {
    return { error: "Event not found." };
  }

  await prisma.event.update({ where: { id: eventId }, data: { deletedAt: new Date() } });
  return {};
});

export const rsvpToEvent = withOrgContext(
  async (ctx, eventId: string, rsvp: string): Promise<ActionResult> => {
    const parsedRsvp = z.enum(RSVP_VALUES).safeParse(rsvp);
    if (!parsedRsvp.success) {
      return { error: "Invalid RSVP value." };
    }

    const attendee = await prisma.eventAttendee.findUnique({
      where: { eventId_userId: { eventId, userId: ctx.user.id } },
    });
    if (!attendee) {
      return { error: "You aren't invited to this event." };
    }

    await prisma.eventAttendee.update({
      where: { eventId_userId: { eventId, userId: ctx.user.id } },
      data: { rsvp: parsedRsvp.data },
    });
    return {};
  },
);
