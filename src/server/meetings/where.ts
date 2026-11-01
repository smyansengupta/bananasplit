import type { Prisma } from "@/generated/prisma/client";

/**
 * The meetings the Meetings page lists, for whoever is looking. Hosts work
 * from the whole list. Everyone else sees what they can act on: something
 * to join, or a page open for sign-ups, still to come. Row policies have
 * already limited this to what they may see. Find a time counts the same
 * rows for the Meetings tab, so both pages show one number.
 */
export function meetingsWhere(
  organizationId: string,
  userId: string,
  canManage: boolean,
  now: Date,
): Prisma.EventWhereInput {
  return {
    organizationId,
    deletedAt: null,
    mergedIntoId: null,
    ...(canManage
      ? {}
      : {
          endsAt: { gt: now },
          // Something to join, a page taking sign-ups, or a meeting they
          // were invited to (an in-person one has neither).
          OR: [
            { rsvpEnabled: true },
            { conferenceUrl: { not: null } },
            { attendees: { some: { userId } } },
          ],
        }),
  };
}
