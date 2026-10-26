"use server";

import { UP_NEXT_KINDS, type UpNextKind } from "@/lib/overview/up-next";
import { withOrgAction } from "@/server/db/context";

/**
 * Hiding a card from your own "Up next" (docs/features/meetings.md has the
 * table; this is the Overview half).
 *
 * Per member, not per org: the stale poll everyone can see is still everyone's
 * to decide about. Own-row RLS enforces that, and the action pins userId to
 * the session anyway, so nothing here can hide a card for somebody else.
 *
 * Hiding is an insert and un-hiding a delete; there is no update. A dismissal
 * for something later deleted is simply never matched.
 *
 * The caller refreshes the page itself (router.refresh). There is no cache tag
 * to invalidate here: the Overview is dynamic and per member, so there is
 * nothing cached to throw away - only this viewer's view to redraw.
 */

function parse(kind: unknown, refId: unknown): { kind: UpNextKind; refId: string } | null {
  if (typeof kind !== "string" || typeof refId !== "string") return null;
  if (!(UP_NEXT_KINDS as readonly string[]).includes(kind)) return null;
  const id = refId.trim();
  if (id.length === 0 || id.length > 64) return null;
  return { kind: kind as UpNextKind, refId: id };
}

export const hideUpNextCard = withOrgAction(
  async (ctx, kind: unknown, refId: unknown): Promise<{ ok: boolean; error?: string }> => {
    const parsed = parse(kind, refId);
    if (!parsed) return { ok: false, error: "That isn't a card we can hide." };
    await ctx.db.upNextDismissal.upsert({
      where: {
        userId_organizationId_kind_refId: {
          userId: ctx.userId,
          organizationId: ctx.organizationId,
          kind: parsed.kind,
          refId: parsed.refId,
        },
      },
      create: {
        userId: ctx.userId,
        organizationId: ctx.organizationId,
        kind: parsed.kind,
        refId: parsed.refId,
      },
      update: {},
      select: { refId: true },
    });
    return { ok: true };
  },
  { onRefused: "return" },
);

/** Puts every hidden card back. */
export const showHiddenUpNextCards = withOrgAction(
  async (ctx): Promise<{ ok: boolean; restored: number }> => {
    const gone = await ctx.db.upNextDismissal.deleteMany({
      where: { userId: ctx.userId, organizationId: ctx.organizationId },
    });
    return { ok: true, restored: gone.count };
  },
  { onRefused: "return" },
);
