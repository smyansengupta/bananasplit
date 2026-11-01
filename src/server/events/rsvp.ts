import type { RSVPStatus } from "@/generated/prisma/client";
import type { MemberContext } from "@/server/db/context";

/**
 * A member answers their own invitation to an event: the calendar's RSVP
 * buttons and the AI connectors' rsvp_to_event (src/server/connectors).
 * Only the caller's own EventAttendee row is touched, and RLS repeats that
 * rule. An event they aren't invited to has no row, so nothing changes.
 */

export const NOT_INVITED = "You aren't invited to this event.";

export async function setOwnRsvp(
  ctx: Pick<MemberContext, "db" | "organizationId" | "userId">,
  eventId: string,
  status: RSVPStatus,
): Promise<{ error?: string }> {
  const updated = await ctx.db.eventAttendee.updateMany({
    where: { organizationId: ctx.organizationId, eventId, userId: ctx.userId },
    data: { rsvp: status },
  });
  if (updated.count === 0) return { error: NOT_INVITED };
  return {};
}
