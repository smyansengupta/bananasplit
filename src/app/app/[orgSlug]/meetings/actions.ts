"use server";

import { can } from "@/lib/auth/permissions";
import { loadMeetingConnections, type MeetingConnection } from "@/server/conference/connections";
import { withOrgAction } from "@/server/db/context";

/**
 * Which video accounts this organization has connected, for the client
 * (docs/features/meetings.md).
 *
 * The create flow reads this rather than having it threaded down from a page,
 * and reads it again when the window regains focus: connecting happens in a
 * second tab, so coming back is exactly the moment the answer changes.
 *
 * It carries no secret - a label, a status and the connected account - and
 * runs as the session user, so a non-member gets NotFoundError before
 * anything is read.
 */
const connectionsTx = withOrgAction(
  async (ctx): Promise<MeetingConnection[]> => {
    // Everyone who can make an event may see which providers are available,
    // so the picker can say "Zoom" instead of an empty list. Only owners and
    // admins are offered the Connect button (the start route checks again).
    if (!can(ctx, "events.write")) return [];
    return loadMeetingConnections(ctx.organizationId);
  },
  { feature: "rsvp", whenPaused: "allow" },
);

export async function meetingConnectionsAction(
  organizationId: string,
): Promise<MeetingConnection[]> {
  return connectionsTx(organizationId);
}
