import { withSystemOrgTx } from "@/server/db/context";

/**
 * The upcoming meetings booked on organization links this member also hosts,
 * where round-robin gave the booking to someone else. They aren't attending
 * (an invitation would block their own time and ask them to reply), so
 * meetingsWhere takes these to keep the meeting on their Meetings list.
 *
 * Service path because members read only the bookings they host (guests'
 * details stay there): this hands back event ids and nothing else, and
 * every member can read the event already.
 */
export async function coHostedEventIds(organizationId: string, userId: string, now: Date): Promise<string[]> {
  const rows = await withSystemOrgTx(organizationId, ({ db }) =>
    db.booking.findMany({
      where: {
        organizationId,
        status: "BOOKED",
        endsAt: { gt: now },
        hostUserId: { not: userId },
        page: { ownerUserId: null, hostIds: { has: userId } },
      },
      orderBy: { startsAt: "asc" },
      select: { eventId: true },
      take: 200,
    }),
  );
  return rows.map((r) => r.eventId);
}
