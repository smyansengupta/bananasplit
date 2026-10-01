"use server";

import { z } from "zod";

import { withOrgAction, type TxClient } from "@/server/db/context";
import { pinPage, recordVisit, reorderPins, togglePin, unpin, type PinResult } from "@/server/pins";
import { searchPinnables, type PinnableGroup } from "@/server/pins/search";

/**
 * Pins and "Recently visited" (the shell's pin button, the visit tracker,
 * the sidebar's Pinned list). Every write is the member's own row in the
 * org (RLS); the org's slug comes from the database, never the client.
 */

const pathSchema = z.string().min(1).max(400);

async function slugOf(db: TxClient, orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { slug: true } });
  return org?.slug ?? null;
}

export const togglePinAction = withOrgAction(async (ctx, pathname: string): Promise<PinResult> => {
  const path = pathSchema.safeParse(pathname);
  const slug = await slugOf(ctx.db, ctx.organizationId);
  if (!path.success || !slug) return { ok: false, error: "This page can't be pinned." };
  return togglePin(ctx.db, ctx.organizationId, slug, ctx.userId, path.data);
});

export const unpinAction = withOrgAction(async (ctx, pinId: string): Promise<void> => {
  await unpin(ctx.db, ctx.organizationId, ctx.userId, z.string().max(64).parse(pinId));
});

export const recordVisitAction = withOrgAction(async (ctx, pathname: string): Promise<void> => {
  const path = pathSchema.safeParse(pathname);
  const slug = await slugOf(ctx.db, ctx.organizationId);
  if (!path.success || !slug) return;
  await recordVisit(ctx.db, ctx.organizationId, slug, ctx.userId, path.data);
});

/** Pins a page (dragged onto Pinned, or a card's pin button). */
export const pinPathAction = withOrgAction(async (ctx, pathname: string): Promise<PinResult> => {
  const path = pathSchema.safeParse(pathname);
  const slug = await slugOf(ctx.db, ctx.organizationId);
  if (!path.success || !slug) return { ok: false, error: "That can't be pinned." };
  return pinPage(ctx.db, ctx.organizationId, slug, ctx.userId, path.data);
});

export const reorderPinsAction = withOrgAction(async (ctx, ids: string[]): Promise<void> => {
  const parsed = z.array(z.string().max(64)).max(50).parse(ids);
  await reorderPins(ctx.db, ctx.organizationId, ctx.userId, parsed);
});

/** "Pin something": what the member can pin, matching `query` (as them, under RLS). */
export const searchPinnablesAction = withOrgAction(
  async (ctx, query: string): Promise<PinnableGroup[]> => {
    const slug = await slugOf(ctx.db, ctx.organizationId);
    if (!slug) return [];
    return searchPinnables(ctx.db, ctx.organizationId, slug, ctx.userId, z.string().max(200).catch("").parse(query));
  },
);
