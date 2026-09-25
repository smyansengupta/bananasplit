import type { Prisma } from "@/generated/prisma/client";
import type { IcsEvent } from "@/lib/ics";

/**
 * The events a user's personal ICS feed may contain (0A Fix 7): events they
 * are invited to, not deleted, in an org that still exists and that they are
 * STILL a member of. Membership is re-checked on every poll, so leaving or
 * being removed from an org takes its events out of the feed even if an
 * EventAttendee row survived (removeMember also deletes those rows).
 */
export function feedEventsWhere(userId: string): Prisma.EventWhereInput {
  return {
    deletedAt: null,
    attendees: { some: { userId } },
    organization: { deletedAt: null, memberships: { some: { userId } } },
  };
}

/** The same filter inside one org (the feed reads org by org on the service path). */
export function feedEventsWhereInOrg(
  userId: string,
  organizationId: string,
): Prisma.EventWhereInput {
  return { ...feedEventsWhere(userId), organizationId, mergedIntoId: null };
}

/** The columns an ICS entry needs. */
export const icsEventSelect = {
  id: true,
  title: true,
  description: true,
  location: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  updatedAt: true,
  createdAt: true,
  syncVersion: true,
  rsvpUrl: true,
} satisfies Prisma.EventSelect;

export type IcsEventRow = Prisma.EventGetPayload<{ select: typeof icsEventSelect }>;

export function toIcsEvent(row: IcsEventRow, timeZone: string): IcsEvent {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    allDay: row.allDay,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    sequence: row.syncVersion,
    status: "CONFIRMED",
    url: row.rsvpUrl,
    timeZone,
  };
}
