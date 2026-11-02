"use server";

import { withOrgAction } from "@/server/db/context";
import { markHere, onlineNow, pageOf, presenceOrg, type OnlineNow } from "@/server/presence";

/**
 * The open app's heartbeat (PresenceBeat in the shell): marks you here in this
 * organization, on the page you have open (`pathname`, named by its sidebar
 * section), and answers who else is, in one round trip. A beat sent because
 * you moved to another page (`moved`) only marks you and answers null: the
 * minute's beat keeps who's online current. Your own row only (RLS); the
 * organization comes from the action's context.
 */
export const presenceBeatAction = withOrgAction(
  async (ctx, pathname?: unknown, moved?: unknown): Promise<OnlineNow | null> => {
    // The slug the path must be under, and the sidebar's names (kept a minute).
    const org = await presenceOrg(ctx.db, ctx.organizationId);
    const page = org ? pageOf(pathname, org.slug, org.sidebar) : null;
    await markHere(ctx.db, ctx.organizationId, ctx.userId, page);
    if (moved === true) return null;
    return onlineNow(ctx.db, ctx.organizationId, ctx.userId);
  },
);
