"use server";

import { z } from "zod";

import { IntegrationProvider, MeetingFormat } from "@/generated/prisma/enums";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { can, requirePermission } from "@/lib/auth/permissions";
import { loadMeetingConnections, type MeetingConnection } from "@/server/conference/connections";
import { disconnectMeetingProvider } from "@/server/conference/disconnect";
import { MEETING_INTEGRATIONS, providerForConference } from "@/server/conference/providers";
import { withOrgAction } from "@/server/db/context";
import { resolveActor } from "@/server/integrations/service";
import { enqueueJob } from "@/server/jobs/enqueue";

import { actionError } from "../calendar/action-result";

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

const retryTx = withOrgAction(async (ctx, eventId: string): Promise<{ error?: string }> => {
  requirePermission(ctx, "events.write");
  const event = await ctx.db.event.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null, mergedIntoId: null },
    select: {
      format: true,
      conferenceProvider: true,
      conferenceManaged: true,
      conferenceUrl: true,
    },
  });
  if (!event) return { error: "That meeting no longer exists." };

  // Only a meeting the sync job could make: online, at a provider we have a
  // client for, and not a link someone pasted (the job never touches one, so
  // marking it PENDING would leave it that way).
  const wantsOne =
    event.format !== MeetingFormat.IN_PERSON &&
    providerForConference(event.conferenceProvider) !== null &&
    (event.conferenceManaged || !event.conferenceUrl);
  if (!wantsOne) return { error: "This meeting has no video call to make." };

  // PENDING first, as afterSave does (src/server/events/service.ts): the page
  // then says "getting the link" at once. Raw, because marking a row is not an
  // edit, so updatedAt stays where it was. The job is enqueued in the same
  // transaction, so a row is never PENDING with no job to resolve it.
  await ctx.db.$executeRaw`
    UPDATE "Event" SET "conferenceSyncState" = 'PENDING'::"CalendarSyncState"
     WHERE "organizationId" = ${ctx.organizationId} AND "id" = ${eventId}`;
  await enqueueJob(ctx.db, {
    orgId: ctx.organizationId,
    kind: "conference-sync",
    key: eventId,
    payload: { eventId },
  });
  return {};
});

/**
 * "Try again" on a meeting whose video call failed (docs/features/meetings.md):
 * owners and admins, like every other change to an event.
 *
 * It queues the same conference-sync job a save does and nothing more, so the
 * job's own rules still decide what happens (a pasted link is never touched, a
 * provider that needs reconnecting says so on the row). Returns `{ error }`
 * rather than throwing, so the button can show why.
 */
export async function retryConferenceSync(
  orgId: string,
  eventId: string,
): Promise<{ error?: string }> {
  try {
    return await retryTx(orgId, eventId);
  } catch (error) {
    if (error instanceof NotFoundError) return { error: "That meeting no longer exists." };
    return actionError(error);
  }
}
