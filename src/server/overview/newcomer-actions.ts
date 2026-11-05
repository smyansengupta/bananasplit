"use server";

import { NEWCOMER_DISMISSAL } from "@/lib/ambient/people";
import { withOrgAction } from "@/server/db/context";

/**
 * Dismissing someone new: their "joined" row goes from your People page and
 * Since you were here, without saying hi. Per member, kept with the cards
 * you hid from Up next (UpNextDismissal): own-row RLS, and userId is the
 * session's, so nobody can dismiss for anyone else.
 */

const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id);

export const dismissNewcomer = withOrgAction(
  async (ctx, personId: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!validId(personId)) return { ok: false, error: "That person isn't here." };
    const row = {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      kind: NEWCOMER_DISMISSAL,
      refId: personId,
    };
    await ctx.db.upNextDismissal.upsert({
      where: { userId_organizationId_kind_refId: row },
      create: row,
      update: {},
      select: { refId: true },
    });
    return { ok: true };
  },
  { onRefused: "return" },
);

/** Undo for dismissNewcomer. */
export const undismissNewcomer = withOrgAction(
  async (ctx, personId: unknown): Promise<{ ok: boolean; error?: string }> => {
    if (!validId(personId)) return { ok: false, error: "That person isn't here." };
    await ctx.db.upNextDismissal.deleteMany({
      where: {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        kind: NEWCOMER_DISMISSAL,
        refId: personId,
      },
    });
    return { ok: true };
  },
  { onRefused: "return" },
);
