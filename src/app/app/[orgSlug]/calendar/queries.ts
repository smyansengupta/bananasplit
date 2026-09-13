import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const eventInclude = {
  attendees: {
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
  },
  createdBy: { select: { id: true, name: true, email: true, image: true } },
  notes: { select: { id: true, title: true } },
} satisfies Prisma.EventInclude;

export type EventWithRelations = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

export function getOrgEvents(organizationId: string) {
  return prisma.event.findMany({
    where: { organizationId, deletedAt: null },
    include: eventInclude,
    orderBy: { startsAt: "asc" },
  });
}

export function getEventById(organizationId: string, eventId: string) {
  return prisma.event.findFirst({
    where: { id: eventId, organizationId, deletedAt: null },
    include: eventInclude,
  });
}

export function getOrgMembersForPicker(organizationId: string) {
  return prisma.membership.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

export const pollInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
  slots: { orderBy: { startsAt: "asc" as const } },
  responses: {
    include: { user: { select: { id: true, name: true, email: true } } },
  },
  finalizedEvent: { select: { id: true, title: true } },
} satisfies Prisma.AvailabilityPollInclude;

export type PollWithRelations = Prisma.AvailabilityPollGetPayload<{ include: typeof pollInclude }>;

export function getOrgPolls(organizationId: string) {
  return prisma.availabilityPoll.findMany({
    where: { organizationId },
    include: pollInclude,
    orderBy: { createdAt: "desc" },
  });
}

export function getPollById(pollId: string) {
  return prisma.availabilityPoll.findUnique({
    where: { id: pollId },
    include: pollInclude,
  });
}
