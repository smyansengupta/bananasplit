"use server";

import { z } from "zod";

import { IntegrationProvider } from "@/generated/prisma/enums";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { loadMeetingConnections, type MeetingConnection } from "@/server/conference/connections";
import { disconnectMeetingProvider } from "@/server/conference/disconnect";
import { MEETING_INTEGRATIONS } from "@/server/conference/providers";
import { withOrgAction } from "@/server/db/context";
import { resolveActor } from "@/server/integrations/service";

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

const orgIdSchema = z.string().min(1).max(100);
/** Only the video-call providers: this is not a way to disconnect anything else. */
const meetingProviderSchema = z
  .enum(IntegrationProvider)
  .refine((provider) => MEETING_INTEGRATIONS.includes(provider));

/**
 * Disconnect a video-call provider (docs/features/meetings.md).
 *
 * Not withOrgAction, for the reason Settings > Integrations is not: the
 * revoke is a network call and must run with no transaction open. The caller's
 * role is resolved through the database first (a non-member gets nothing),
 * then disconnectMeetingProvider checks the permission. The result carries a
 * message and never a token.
 */
export async function disconnectMeetingProviderAction(
  orgId: string,
  provider: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const actor = await resolveActor(orgIdSchema.parse(orgId));
    const result = await disconnectMeetingProvider(
      orgId,
      actor,
      meetingProviderSchema.parse(provider),
    );
    return result.ok
      ? { ok: true, message: result.message ?? "Disconnected." }
      : { ok: false, message: result.error };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    if (error instanceof NotFoundError) return { ok: false, message: "Not found." };
    if (error instanceof z.ZodError) return { ok: false, message: "Invalid input." };
    throw error;
  }
}
