"use server";

import { z } from "zod";

import { requirePermission } from "@/lib/auth/permissions";
import { cleanTagName, MAX_TAG_NAME, MAX_TAGS_PER_ORG, TAG_COLORS } from "@/lib/calendar/tags";
import { writeOrgAuditLog } from "@/server/audit";
import { withOrgAction } from "@/server/db/context";
import { sqlStateOf } from "@/server/db/errors";

/**
 * The organization's own event types (EventTag), written by owners and
 * admins. The RLS policies say the same thing, so a member who gets past
 * these checks still cannot write a row.
 *
 * A name that already exists in any case is refused rather than doubled:
 * the unique index on ("organizationId", lower("name")) settles a race the
 * same way, and 23505 comes back as the same message.
 */

const DUPLICATE = "There is already a type with that name.";

const nameSchema = z.string().trim().min(1, "Give the type a name.").max(MAX_TAG_NAME);
const colorSchema = z.enum(TAG_COLORS).nullable();

export const createEventTag = withOrgAction(
  async (ctx, input: { name: string; color: string | null }) => {
    requirePermission(ctx, "settings.general.write");
    const parsed = z.object({ name: nameSchema, color: colorSchema }).safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That name won't do." };
    const name = cleanTagName(parsed.data.name);
    if (!name) return { error: "Give the type a name." };

    const count = await ctx.db.eventTag.count({ where: { organizationId: ctx.organizationId } });
    if (count >= MAX_TAGS_PER_ORG) {
      return { error: `A calendar holds ${MAX_TAGS_PER_ORG} types. Delete one to add another.` };
    }
    try {
      const tag = await ctx.db.eventTag.create({
        data: {
          organizationId: ctx.organizationId,
          name,
          color: parsed.data.color,
          sortOrder: count,
        },
        select: { id: true, name: true, color: true },
      });
      await writeOrgAuditLog(ctx.db, {
        organizationId: ctx.organizationId,
        action: "event_type.created",
        targetType: "EventTag",
        targetId: tag.id,
        diff: { name },
      });
      return { tag };
    } catch (error) {
      if (sqlStateOf(error) === "23505") return { error: DUPLICATE };
      throw error;
    }
  },
);

export const updateEventTag = withOrgAction(
  async (ctx, input: { id: string; name?: string; color?: string | null }) => {
    requirePermission(ctx, "settings.general.write");
    const parsed = z
      .object({ id: z.string().min(1), name: nameSchema.optional(), color: colorSchema.optional() })
      .safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "That won't do." };
    const cleaned = parsed.data.name === undefined ? undefined : cleanTagName(parsed.data.name);
    const name = cleaned ?? undefined;
    if (parsed.data.name !== undefined && !name) return { error: "Give the type a name." };
    try {
      const tag = await ctx.db.eventTag.update({
        where: { id: parsed.data.id, organizationId: ctx.organizationId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(parsed.data.color !== undefined ? { color: parsed.data.color } : {}),
        },
        select: { id: true, name: true, color: true },
      });
      await writeOrgAuditLog(ctx.db, {
        organizationId: ctx.organizationId,
        action: "event_type.updated",
        targetType: "EventTag",
        targetId: tag.id,
        diff: { name: tag.name },
      });
      return { tag };
    } catch (error) {
      if (sqlStateOf(error) === "23505") return { error: DUPLICATE };
      throw error;
    }
  },
);

/**
 * Deleting a type leaves its events alone: the foreign key sets their tagId
 * to NULL, so they keep their place on the calendar with no type, exactly
 * as an untyped event always has.
 */
export const deleteEventTag = withOrgAction(async (ctx, input: { id: string }) => {
  requirePermission(ctx, "settings.general.write");
  const tag = await ctx.db.eventTag.findFirst({
    where: { id: input.id, organizationId: ctx.organizationId },
    select: { name: true },
  });
  if (!tag) return { error: "That type is already gone." };
  const used = await ctx.db.event.count({
    where: { organizationId: ctx.organizationId, tagId: input.id, deletedAt: null },
  });
  await ctx.db.eventTag.delete({ where: { id: input.id, organizationId: ctx.organizationId } });
  await writeOrgAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    action: "event_type.deleted",
    targetType: "EventTag",
    targetId: input.id,
    diff: { name: tag.name },
  });
  return { ok: true as const, untyped: used };
});

/** Moves a type one place up or down the list the calendar draws. */
export const moveEventTag = withOrgAction(
  async (ctx, input: { id: string; direction: "up" | "down" }) => {
    requirePermission(ctx, "settings.general.write");
    const tags = await ctx.db.eventTag.findMany({
      where: { organizationId: ctx.organizationId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true },
    });
    const at = tags.findIndex((t) => t.id === input.id);
    const to = input.direction === "up" ? at - 1 : at + 1;
    if (at < 0 || to < 0 || to >= tags.length) return { ok: true as const };
    const order = [...tags];
    const [moved] = order.splice(at, 1);
    order.splice(to, 0, moved!);
    // Rewritten whole: a list this short is cheaper to renumber than to patch.
    for (const [i, t] of order.entries()) {
      await ctx.db.eventTag.update({
        where: { id: t.id, organizationId: ctx.organizationId },
        data: { sortOrder: i },
      });
    }
    return { ok: true as const };
  },
);
