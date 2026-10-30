"use server";

import { z } from "zod";

import { withOrgAction, type OrgContext } from "@/server/db/context";
import {
  isLinkKind,
  listLinked,
  resolveRefs,
  type LinkedItem,
  type LinkRef,
} from "@/server/links/links";

/**
 * The Linked panel's actions. Linking checks that the member can see BOTH
 * ends (each must resolve as them) before the row is written, so nobody can
 * pin a link to something they couldn't open. Removing a link deletes the
 * row and hands back its two ends, which is all Undo needs.
 */

const refSchema = z.object({
  kind: z.string().refine(isLinkKind),
  id: z.string().min(1).max(64),
});
const slugSchema = z.string().min(1).max(100);

/** The organization's time zone, for the dates on linked meetings. */
async function zoneOf(ctx: OrgContext): Promise<string> {
  const org = await ctx.db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { timezone: true },
  });
  return org?.timezone ?? "UTC";
}

export const listLinksAction = withOrgAction(
  async (ctx, orgSlug: string, ref: LinkRef): Promise<LinkedItem[]> => {
    const at = refSchema.parse(ref) as LinkRef;
    return listLinked(ctx.db, ctx.organizationId, slugSchema.parse(orgSlug), at, await zoneOf(ctx));
  },
);

export const addLinkAction = withOrgAction(
  async (
    ctx,
    orgSlug: string,
    from: LinkRef,
    to: LinkRef,
  ): Promise<{ error?: string; item?: LinkedItem }> => {
    const a = refSchema.parse(from) as LinkRef;
    const b = refSchema.parse(to) as LinkRef;
    if (a.kind === b.kind && a.id === b.id) return { error: "That's this page." };
    const slug = slugSchema.parse(orgSlug);
    const seen = await resolveRefs(ctx.db, ctx.organizationId, slug, [a, b], await zoneOf(ctx));
    if (!seen.has(`${a.kind}:${a.id}`) || !seen.has(`${b.kind}:${b.id}`)) {
      return { error: "Couldn't find that." };
    }
    // Already linked either way round: nothing to add.
    const existing = await ctx.db.itemLink.findFirst({
      where: {
        organizationId: ctx.organizationId,
        OR: [
          { fromKind: a.kind, fromId: a.id, toKind: b.kind, toId: b.id },
          { fromKind: b.kind, fromId: b.id, toKind: a.kind, toId: a.id },
        ],
      },
      select: { id: true },
    });
    const row =
      existing ??
      (await ctx.db.itemLink.create({
        data: {
          organizationId: ctx.organizationId,
          fromKind: a.kind,
          fromId: a.id,
          toKind: b.kind,
          toId: b.id,
          createdById: ctx.userId,
        },
        select: { id: true },
      }));
    return { item: { ...seen.get(`${b.kind}:${b.id}`)!, linkId: row.id } };
  },
);

export const removeLinkAction = withOrgAction(
  async (ctx, linkId: string): Promise<{ error?: string }> => {
    const id = z.string().min(1).max(64).parse(linkId);
    const gone = await ctx.db.itemLink.deleteMany({
      where: { id, organizationId: ctx.organizationId },
    });
    return gone.count === 0 ? { error: "That link is already gone." } : {};
  },
);
