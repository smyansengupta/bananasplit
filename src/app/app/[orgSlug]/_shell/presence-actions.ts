"use server";

import { withOrgAction } from "@/server/db/context";
import { markHere, onlineNow, type OnlineNow } from "@/server/presence";

/**
 * The open app's heartbeat (PresenceBeat in the shell): marks you here in this
 * organization and answers who else is, in one round trip. Your own row
 * only (RLS); the organization comes from the action's context.
 */
export const presenceBeatAction = withOrgAction(async (ctx): Promise<OnlineNow> => {
  await markHere(ctx.db, ctx.organizationId, ctx.userId);
  return onlineNow(ctx.db, ctx.organizationId, ctx.userId);
});
