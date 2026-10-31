"use server";

import { parseInboxKey, snoozeUntil, SNOOZE_CHOICES, type SnoozeChoice } from "@/lib/inbox/items";
import { effectiveTimezone } from "@/lib/tasks/dates";
import { withOrgAction, type OrgContext } from "@/server/db/context";

/**
 * The Inbox's own changes: putting an item off (Snooze) and finishing with
 * an update (Done), each with its undo. Per member: the policies pin
 * userId to the session and so does every call here, so nothing can snooze
 * or finish an item for somebody else. The caller refreshes the page.
 */

type Result = { ok: true; until?: string } | { ok: false; error: string };

const BAD_KEY = "That isn't an Inbox item.";

/**
 * One key or a few (a row that stands for the same update repeated), each
 * normalised; null when any is not an Inbox key.
 */
function parseKeys(value: unknown): { kind: string; key: string }[] | null {
  const list = Array.isArray(value) ? value : [value];
  if (list.length === 0 || list.length > 50) return null;
  const out: { kind: string; key: string }[] = [];
  for (const v of list) {
    const parsed = parseInboxKey(v);
    if (!parsed) return null;
    out.push({ kind: parsed.kind, key: `${parsed.kind}:${parsed.id}` });
  }
  return out;
}

async function save(
  ctx: OrgContext,
  itemKey: string,
  data: { snoozedUntil?: Date | null; doneAt?: Date | null },
) {
  const where = {
    userId_organizationId_itemKey: {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      itemKey,
    },
  };
  await ctx.db.inboxItemState.upsert({
    where,
    create: { userId: ctx.userId, organizationId: ctx.organizationId, itemKey, ...data },
    update: { ...data, updatedAt: new Date() },
    select: { itemKey: true },
  });
  // A row that remembers nothing any more goes.
  await ctx.db.inboxItemState.deleteMany({
    where: {
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      itemKey,
      snoozedUntil: null,
      doneAt: null,
    },
  });
}

/** Puts an item off: it leaves the list and comes back at the chosen time. */
export const snoozeInboxItem = withOrgAction(
  async (ctx, key: unknown, choice: unknown): Promise<Result> => {
    const keys = parseKeys(key);
    if (!keys) return { ok: false, error: BAD_KEY };
    if (!(SNOOZE_CHOICES as readonly unknown[]).includes(choice)) {
      return { ok: false, error: "Pick when it should come back." };
    }
    const [me, org] = await Promise.all([
      ctx.db.user.findUnique({ where: { id: ctx.userId }, select: { timezone: true } }),
      ctx.db.organization.findUnique({
        where: { id: ctx.organizationId },
        select: { timezone: true },
      }),
    ]);
    const tz = effectiveTimezone(me, org ?? { timezone: "UTC" });
    const until = snoozeUntil(choice as SnoozeChoice, new Date(), tz);
    for (const k of keys) await save(ctx, k.key, { snoozedUntil: until });
    return { ok: true, until: until.toISOString() };
  },
  { onRefused: "return" },
);

/** Brings a snoozed item back now (also Snooze's Undo). */
export const unsnoozeInboxItem = withOrgAction(
  async (ctx, key: unknown): Promise<Result> => {
    const keys = parseKeys(key);
    if (!keys) return { ok: false, error: BAD_KEY };
    for (const k of keys) await save(ctx, k.key, { snoozedUntil: null });
    return { ok: true };
  },
  { onRefused: "return" },
);

/** Done with an update or a few (they leave the list), or not (Undo). */
export const setInboxItemDone = withOrgAction(
  async (ctx, key: unknown, done: unknown): Promise<Result> => {
    const keys = parseKeys(key);
    if (!keys) return { ok: false, error: BAD_KEY };
    for (const k of keys) {
      await save(
        ctx,
        k.key,
        done === true ? { doneAt: new Date(), snoozedUntil: null } : { doneAt: null },
      );
    }
    // Done is read too.
    const updates = keys
      .filter((k) => k.kind === "update")
      .map((k) => k.key.slice("update:".length));
    if (done === true && updates.length > 0) {
      await ctx.db.notification.updateMany({
        where: { id: { in: updates }, userId: ctx.userId, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return { ok: true };
  },
  { onRefused: "return" },
);

/**
 * Clears the read updates out of the list in one go (they stay in the
 * database, only marked Done for this member). Returns the keys for Undo.
 */
export const clearReadUpdates = withOrgAction(
  async (ctx): Promise<{ ok: true; keys: string[] }> => {
    const read = await ctx.db.notification.findMany({
      where: { organizationId: ctx.organizationId, userId: ctx.userId, readAt: { not: null } },
      select: { id: true },
      take: 500,
    });
    const keys = read.map((n) => `update:${n.id}`);
    if (keys.length === 0) return { ok: true, keys };
    const now = new Date();
    const existing = await ctx.db.inboxItemState.findMany({
      where: { organizationId: ctx.organizationId, userId: ctx.userId, itemKey: { in: keys } },
      select: { itemKey: true, doneAt: true },
    });
    const already = new Set(existing.filter((e) => e.doneAt).map((e) => e.itemKey));
    const fresh = keys.filter((k) => !already.has(k));
    const known = new Set(existing.map((e) => e.itemKey));
    await ctx.db.inboxItemState.createMany({
      data: fresh
        .filter((k) => !known.has(k))
        .map((itemKey) => ({
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          itemKey,
          doneAt: now,
        })),
      skipDuplicates: true,
    });
    await ctx.db.inboxItemState.updateMany({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        itemKey: { in: fresh.filter((k) => known.has(k)) },
      },
      data: { doneAt: now, snoozedUntil: null, updatedAt: now },
    });
    return { ok: true, keys: fresh };
  },
);

/** Undo for Clear read: puts those updates back. */
export const restoreInboxItems = withOrgAction(
  async (ctx, keys: unknown): Promise<Result> => {
    if (!Array.isArray(keys) || keys.length > 500) return { ok: false, error: BAD_KEY };
    const valid = keys.filter((k) => parseInboxKey(k) !== null) as string[];
    await ctx.db.inboxItemState.deleteMany({
      where: {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        itemKey: { in: valid },
        snoozedUntil: null,
      },
    });
    await ctx.db.inboxItemState.updateMany({
      where: { organizationId: ctx.organizationId, userId: ctx.userId, itemKey: { in: valid } },
      data: { doneAt: null, updatedAt: new Date() },
    });
    return { ok: true };
  },
  { onRefused: "return" },
);
