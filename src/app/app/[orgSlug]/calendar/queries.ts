import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * An event's relations as `viewerId` may see them. Linked notes follow the
 * notes rules (0A Fix 11): deleted notes never, and PRIVATE notes only for
 * their author, regardless of role (their titles used to leak here).
 */
export function eventInclude(viewerId: string) {
  return {
    attendees: {
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    },
    createdBy: { select: { id: true, name: true, email: true, image: true } },
    notes: {
      where: {
        deletedAt: null,
        OR: [{ visibility: "ORGANIZATION" as const }, { authorId: viewerId }],
      },
      select: { id: true, title: true },
      orderBy: { createdAt: "asc" as const },
    },
  } satisfies Prisma.EventInclude;
}

export type EventWithRelations = Prisma.EventGetPayload<{
  include: ReturnType<typeof eventInclude>;
}>;

/** What the calendar grid needs per event: no attendees, no notes. */
export const calendarEventSelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  createdById: true,
} satisfies Prisma.EventSelect;

export type CalendarEventSummary = Prisma.EventGetPayload<{ select: typeof calendarEventSelect }>;

export function getOrgEvents(organizationId: string) {
  return prisma.event.findMany({
    where: { organizationId, deletedAt: null },
    select: calendarEventSelect,
    orderBy: { startsAt: "asc" },
  });
}

export function getEventById(organizationId: string, eventId: string, viewerId: string) {
  return prisma.event.findFirst({
    where: { id: eventId, organizationId, deletedAt: null },
    include: eventInclude(viewerId),
  });
}

/**
 * Event create/update/delete rule (0A Fix 8): the creator, or OWNER/ADMIN.
 * The Event UPDATE and DELETE policies enforce the same rule for app_user.
 */
export function canEditEvent(
  event: { createdById: string },
  viewer: { userId: string; role: string },
): boolean {
  return event.createdById === viewer.userId || viewer.role === "OWNER" || viewer.role === "ADMIN";
}

export function getOrgMembersForPicker(organizationId: string) {
  return prisma.membership.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

/** The polls list: titles, a response count and whether each is finalized. */
export function getOrgPolls(organizationId: string) {
  return prisma.availabilityPoll.findMany({
    where: { organizationId },
    select: {
      id: true,
      title: true,
      finalizedEventId: true,
      _count: { select: { responses: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * A poll with what buildPollView (src/lib/polls/poll-view.ts) needs, plus
 * the org and creator for the caller's own checks. Never hand this to a
 * client component: it holds user ids and guest key hashes. Build the DTO.
 */
export function getPollSource(pollId: string) {
  return prisma.availabilityPoll.findUnique({
    where: { id: pollId },
    select: {
      id: true,
      organizationId: true,
      createdById: true,
      title: true,
      description: true,
      timezone: true,
      durationMinutes: true,
      closesAt: true,
      finalizedEventId: true,
      slots: {
        select: { id: true, startsAt: true, endsAt: true },
        orderBy: { startsAt: "asc" },
      },
      responses: {
        select: {
          slotId: true,
          userId: true,
          guestName: true,
          guestKeyHash: true,
          availability: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
}
