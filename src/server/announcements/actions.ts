"use server";

import { z } from "zod";

import { Role } from "@/generated/prisma/enums";
import { effectiveTimezone } from "@/lib/tasks/dates";
import { runResult } from "@/server/action-result";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { loadRecapWeek } from "@/server/overview/recap-week";

import { markSeen } from "./announcements";
import { canManageAnnouncement, canRestoreAnnouncement, cleanAnnouncement } from "./rules";

/**
 * Announcements on the member path: each action is one withOrgAction
 * transaction (app_user, RLS). Any member posts; whoever posted it, or an
 * owner or admin, edits and removes a post, and whoever removed it, or an
 * owner or admin, puts it back (the database holds the same rules,
 * app.announcement_guard). A post can link one event (ItemLink, fromKind
 * "announcement"). Home's recap posts through postRecapAnnouncement, which
 * writes the text itself. Refusals come back as { ok: false, error }; changes
 * refresh the page they were made on.
 *
 *   const result = await postAnnouncement(orgId, { title, body, eventId });
 *   if (!result.ok) toast({ title: result.error, tone: "error" });
 */

export type AnnouncementResult = { ok: true; id?: string } | { ok: false; error: string };

const id = z.string().min(1).max(64);
const GONE = "That announcement is gone.";
const NOT_YOURS = "Only whoever posted it, or an admin, can change it.";
const NOT_YOUR_REMOVAL = "Only whoever took it down, or an admin, can put it back.";
const QUIET_WEEK = "Nothing to recap this week.";
const NO_EVENT = "That event is gone.";

/** The event's id when `value` names a live event the member can see; "" for none. */
async function eventOf(ctx: OrgContext, value: unknown): Promise<string | null | ""> {
  if (value === undefined || value === null || value === "") return "";
  const parsed = id.safeParse(value);
  if (!parsed.success) return null;
  const event = await ctx.db.event.findFirst({
    where: { organizationId: ctx.organizationId, id: parsed.data, deletedAt: null },
    select: { id: true },
  });
  return event?.id ?? null;
}

/** Points the post at `eventId` alone ("" unlinks it). */
async function linkEvent(ctx: OrgContext, postId: string, eventId: string) {
  await ctx.db.itemLink.deleteMany({
    where: {
      organizationId: ctx.organizationId,
      OR: [
        { fromKind: "announcement", fromId: postId, toKind: "event" },
        { toKind: "announcement", toId: postId, fromKind: "event" },
      ],
    },
  });
  if (!eventId) return;
  await ctx.db.itemLink.create({
    data: {
      organizationId: ctx.organizationId,
      fromKind: "announcement",
      fromId: postId,
      toKind: "event",
      toId: eventId,
      createdById: ctx.userId,
    },
    select: { id: true },
  });
}

async function findPost(ctx: OrgContext, postId: unknown, live = true) {
  const parsed = id.safeParse(postId);
  if (!parsed.success) return null;
  return ctx.db.announcement.findFirst({
    where: {
      organizationId: ctx.organizationId,
      id: parsed.data,
      ...(live ? { deletedAt: null } : {}),
    },
    select: { id: true, authorId: true, deletedAt: true, deletedById: true },
  });
}

/** Posts `input` as the member, and marks it seen by them. */
async function createPost(ctx: OrgContext, input: unknown): Promise<AnnouncementResult> {
  const clean = cleanAnnouncement(input);
  if (!clean.ok) return clean;
  const eventId = await eventOf(ctx, (input as { eventId?: unknown } | null)?.eventId);
  if (eventId === null) return { ok: false, error: NO_EVENT };
  const post = await ctx.db.announcement.create({
    data: { organizationId: ctx.organizationId, authorId: ctx.userId, ...clean.draft },
    select: { id: true },
  });
  if (eventId) await linkEvent(ctx, post.id, eventId);
  // Whoever posted it has seen it.
  await markSeen(ctx.db, ctx.organizationId, ctx.userId, [post.id]);
  return { ok: true, id: post.id };
}

const postTx = withOrgAction((ctx, input: unknown): Promise<AnnouncementResult> =>
  createPost(ctx, input),
);

/**
 * The week's recap, written here rather than taken from the page: the
 * viewer's own recap counts what they can see (money, sign-up counts,
 * notes shared with them alone), so the post is rebuilt as any member
 * would see it (loadRecapWeek's "organization" audience).
 */
const recapTx = withOrgAction(async (ctx): Promise<AnnouncementResult> => {
  const org = await ctx.db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { slug: true, timezone: true },
  });
  if (!org) return { ok: false, error: GONE };
  const me = await ctx.db.user.findUnique({
    where: { id: ctx.userId },
    select: { timezone: true },
  });
  const recap = await loadRecapWeek(ctx.db, {
    orgId: ctx.organizationId,
    orgSlug: org.slug,
    userId: ctx.userId,
    role: Role.MEMBER,
    timeZone: effectiveTimezone(me, org),
    now: new Date(),
    audience: "organization",
  });
  if (!recap.text.trim()) return { ok: false, error: QUIET_WEEK };
  return createPost(ctx, { title: recap.title, body: recap.text });
});

const editTx = withOrgAction(
  async (ctx, postId: unknown, input: unknown): Promise<AnnouncementResult> => {
    const post = await findPost(ctx, postId);
    if (!post) return { ok: false, error: GONE };
    if (!canManageAnnouncement(ctx, post)) return { ok: false, error: NOT_YOURS };
    const clean = cleanAnnouncement(input);
    if (!clean.ok) return clean;
    // eventId left out keeps the link; null or "" removes it.
    const raw = (input as { eventId?: unknown } | null) ?? {};
    const eventId = "eventId" in raw ? await eventOf(ctx, raw.eventId) : undefined;
    if (eventId === null) return { ok: false, error: NO_EVENT };
    await ctx.db.announcement.update({
      where: { id: post.id },
      data: { ...clean.draft, updatedAt: new Date() },
      select: { id: true },
    });
    if (eventId !== undefined) await linkEvent(ctx, post.id, eventId);
    return { ok: true, id: post.id };
  },
);

const removeTx = withOrgAction(
  async (ctx, postId: unknown, removed: boolean): Promise<AnnouncementResult> => {
    const post = await findPost(ctx, postId, false);
    if (!post) return { ok: false, error: GONE };
    if (removed) {
      if (!canManageAnnouncement(ctx, post)) return { ok: false, error: NOT_YOURS };
      // Already down: whoever took it down keeps the say over putting it back.
      if (post.deletedAt) return { ok: true, id: post.id };
    } else {
      if (!post.deletedAt) return { ok: true, id: post.id };
      if (!canRestoreAnnouncement(ctx, post)) return { ok: false, error: NOT_YOUR_REMOVAL };
    }
    const now = new Date();
    await ctx.db.announcement.update({
      where: { id: post.id },
      data: removed
        ? { deletedAt: now, deletedById: ctx.userId, updatedAt: now }
        : { deletedAt: null, deletedById: null, updatedAt: now },
      select: { id: true },
    });
    return { ok: true, id: post.id };
  },
);

const seenTx = withOrgAction(async (ctx, ids: unknown): Promise<AnnouncementResult> => {
  const parsed = z.array(id).max(50).safeParse(ids);
  if (!parsed.success) return { ok: false, error: GONE };
  await markSeen(ctx.db, ctx.organizationId, ctx.userId, [...new Set(parsed.data)]);
  return { ok: true };
});

function run(
  fn: () => Promise<AnnouncementResult>,
  refreshAfter = true,
): Promise<AnnouncementResult> {
  return runResult(fn, { gone: GONE, label: "announcements", refreshAfter });
}

/** Any member posts to the whole organization, optionally about one event. */
export async function postAnnouncement(
  orgId: string,
  input: { title: string; body: string; eventId?: string | null },
): Promise<AnnouncementResult> {
  return run(() => postTx(orgId, input));
}

/**
 * Posts the last week's recap (Home) to the whole organization. The text is
 * written on the server as any member would see it: no money, no sign-up
 * counts only admins see, only notes the organization can open. Nothing
 * from the page is trusted.
 */
export async function postRecapAnnouncement(orgId: string): Promise<AnnouncementResult> {
  return run(() => recapTx(orgId));
}

/**
 * The author or an admin changes a post. Leave eventId out to keep its
 * event; null unlinks it.
 */
export async function editAnnouncement(
  orgId: string,
  postId: string,
  input: { title: string; body: string; eventId?: string | null },
): Promise<AnnouncementResult> {
  return run(() => editTx(orgId, postId, input));
}

/** The author or an admin takes a post down (it can be put back: restoreAnnouncement). */
export async function deleteAnnouncement(
  orgId: string,
  postId: string,
): Promise<AnnouncementResult> {
  return run(() => removeTx(orgId, postId, true));
}

/** Undo for deleteAnnouncement: whoever took it down, or an admin. */
export async function restoreAnnouncement(
  orgId: string,
  postId: string,
): Promise<AnnouncementResult> {
  return run(() => removeTx(orgId, postId, false));
}

/**
 * Marks posts seen by the member, as they're shown. Doesn't refresh: the
 * counts catch up on the next render.
 */
export async function markAnnouncementsSeen(
  orgId: string,
  ids: string[],
): Promise<AnnouncementResult> {
  return run(() => seenTx(orgId, ids), false);
}
