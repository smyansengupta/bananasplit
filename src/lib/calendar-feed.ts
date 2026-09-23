import type { Prisma } from "@/generated/prisma/client";

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
