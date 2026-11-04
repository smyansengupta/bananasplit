import type { Prisma } from "@/generated/prisma/client";

/**
 * The meetings the Meetings page lists, for whoever is looking. Hosts work
 * from the whole list. Everyone else sees what they can act on: something
 * to join, or a page open for sign-ups, still to come. Row policies have
 * already limited this to what they may see. Find a time and Booking links
 * count the same rows for the Meetings tab, so every page shows one number.
 * `coHosted` is the meetings booked on organization links they also host
 * (coHostedEventIds): round-robin gave it to someone else, so they aren't
 * attending, but it's still theirs to know about.
 */
export function meetingsWhere(
  organizationId: string,
  userId: string,
  canManage: boolean,
  now: Date,
  coHosted: readonly string[] = [],
): Prisma.EventWhereInput {
  return {
    organizationId,
    deletedAt: null,
    mergedIntoId: null,
    ...(canManage
      ? {}
      : {
          endsAt: { gt: now },
          // Something to join, a page taking sign-ups, a meeting they were
          // invited to (an in-person one has neither), or one booked on a
          // link they host.
          OR: [
            { rsvpEnabled: true },
            { conferenceUrl: { not: null } },
            { attendees: { some: { userId } } },
            ...(coHosted.length > 0 ? [{ id: { in: [...coHosted] } }] : []),
          ],
        }),
  };
}
