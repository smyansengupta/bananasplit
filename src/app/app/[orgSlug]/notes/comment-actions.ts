"use server";

import { z } from "zod";

import { NoteVisibility, NotificationType } from "@/generated/prisma/client";
import { canEditNote, canShareNote } from "@/lib/notes/access";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { listNoteComments, toCommentDto, type NoteCommentDto } from "@/server/notes/comments";
import { loadNote, type LoadedNote } from "@/server/notes/load";
import { notifyUsers } from "@/server/notifications";

/**
 * Comments on a note (Moonstone 13.3; NoteComment). Each action runs as
 * app_user, so RLS repeats every rule checked here: whoever can see the
 * note reads its threads and comments (as themselves); a comment's author
 * changes its text; whoever may edit the note resolves and reopens a
 * thread; the author of a comment, or whoever may share the note, deletes
 * it (a thread's first comment takes its replies with it).
 *
 * @mentions notify (TASK_MENTIONED, "Someone @mentions me in a task or
 * comment"), and a reply tells the thread's earlier commenters
 * (TASK_COMMENTED): the existing notification types, so the bell, email
 * and preferences need nothing new. Only people who can see the note are
 * told.
 */

const filesAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { onRefused: "return", ...options, feature: "files" });

const NOT_FOUND = "Note not found.";
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");

/** Where a thread sits: positions, the text around it, and Yjs relative positions in a live note. */
const anchorSchema = z
  .object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    prefix: z.string().max(80).optional(),
    suffix: z.string().max(80).optional(),
    yjs: z.object({ from: z.unknown(), to: z.unknown() }).optional(),
  })
  .refine((a) => a.to >= a.from, "Invalid anchor")
  .refine((a) => JSON.stringify(a).length <= 2_000, "Invalid anchor");

const addSchema = z.object({
  body: z.string().trim().min(1, "Write a comment first.").max(5000),
  /** The thread's first comment, for a reply. */
  threadId: idSchema.nullable().optional(),
  anchorText: z.string().max(1000).nullable().optional(),
  anchor: anchorSchema.nullable().optional(),
  /** The people @mentioned in it (picked from the members list). */
  mentions: z.array(idSchema).max(20).optional(),
});

export interface CommentsResult {
  error?: string;
  comments?: NoteCommentDto[];
  commentId?: string;
}

async function freshList(ctx: OrgContext, noteId: string): Promise<NoteCommentDto[]> {
  return (await listNoteComments(ctx.db, ctx.organizationId, noteId)).map(toCommentDto);
}

/** Of `userIds`, the members who can see `note` (a club note: everyone in the club). */
async function readersAmong(ctx: OrgContext, note: LoadedNote, userIds: string[]) {
  const wanted = [...new Set(userIds)].filter((id) => id !== ctx.userId);
  if (wanted.length === 0) return [];
  const members = await ctx.db.membership.findMany({
    where: { organizationId: ctx.organizationId, userId: { in: wanted } },
    select: { userId: true },
  });
  const inClub = new Set(members.map((m) => m.userId));
  if (note.visibility === NoteVisibility.ORGANIZATION) return wanted.filter((id) => inClub.has(id));
  const shares = await ctx.db.noteShare.findMany({
    where: { organizationId: ctx.organizationId, noteId: note.id, userId: { in: wanted } },
    select: { userId: true },
  });
  const shared = new Set(shares.map((s) => s.userId));
  return wanted.filter((id) => inClub.has(id) && (id === note.authorId || shared.has(id)));
}

async function noteLink(ctx: OrgContext, noteId: string, commentId: string) {
  const org = await ctx.db.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { slug: true },
  });
  return org ? `/app/${org.slug}/notes/${noteId}?comment=${commentId}` : null;
}

/** Starts a thread (with an anchor, or on the whole note) or replies to one. */
export const addNoteComment = filesAction(
  async (ctx, noteId: string, input: unknown): Promise<CommentsResult> => {
    const parsed = addSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    const { body, threadId, anchorText, anchor, mentions = [] } = parsed.data;

    let thread: { id: string; authorId: string | null } | null = null;
    if (threadId) {
      thread = await ctx.db.noteComment.findFirst({
        where: { id: threadId, noteId, organizationId: ctx.organizationId, threadId: null },
        select: { id: true, authorId: true },
      });
      if (!thread) return { error: "That thread no longer exists." };
    }

    const comment = await ctx.db.noteComment.create({
      data: {
        organizationId: ctx.organizationId,
        noteId,
        authorId: ctx.userId,
        threadId: thread?.id ?? null,
        body,
        // A reply sits where its thread does.
        anchorText: thread ? null : anchorText?.trim() || null,
        anchor: thread || !anchor ? undefined : (anchor as object),
      },
      select: { id: true },
    });

    const name = ctx.user.name?.trim() || "Someone";
    const title = note.title.trim() || "Untitled note";
    const link = await noteLink(ctx, noteId, thread?.id ?? comment.id);
    const mentioned = await readersAmong(ctx, note, mentions);
    if (mentioned.length > 0) {
      await notifyUsers(ctx.db, ctx.organizationId, mentioned, {
        type: NotificationType.TASK_MENTIONED,
        title: `${name} mentioned you in “${title}”`,
        body: body.slice(0, 300),
        linkUrl: link,
        actorId: ctx.userId,
      });
    }
    if (thread) {
      const earlier = await ctx.db.noteComment.findMany({
        where: { organizationId: ctx.organizationId, noteId, threadId: thread.id },
        select: { authorId: true },
      });
      const participants = [thread.authorId, ...earlier.map((c) => c.authorId)].filter(
        (id): id is string => Boolean(id) && !mentioned.includes(id!),
      );
      const told = await readersAmong(ctx, note, participants);
      if (told.length > 0) {
        await notifyUsers(ctx.db, ctx.organizationId, told, {
          type: NotificationType.TASK_COMMENTED,
          title: `${name} replied in “${title}”`,
          body: body.slice(0, 300),
          linkUrl: link,
          actorId: ctx.userId,
        });
      }
    }
    return { commentId: comment.id, comments: await freshList(ctx, noteId) };
  },
);

/** Changes a comment's text: its author only. */
export const editNoteComment = filesAction(
  async (ctx, noteId: string, commentId: string, body: unknown): Promise<CommentsResult> => {
    const parsed = z.string().trim().min(1, "A comment can't be empty.").max(5000).safeParse(body);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    if (!idSchema.safeParse(commentId).success) return { error: "Invalid input" };
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    const result = await ctx.db.noteComment.updateMany({
      where: { id: commentId, noteId, organizationId: ctx.organizationId, authorId: ctx.userId },
      data: { body: parsed.data, updatedAt: new Date() },
    });
    if (result.count === 0) return { error: "Only the person who wrote a comment can change it." };
    return { comments: await freshList(ctx, noteId) };
  },
);

/** Resolves (or reopens) a thread: whoever may edit the note. */
export const resolveNoteThread = filesAction(
  async (ctx, noteId: string, threadId: string, resolved: boolean): Promise<CommentsResult> => {
    if (!idSchema.safeParse(threadId).success) return { error: "Invalid input" };
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    if (!canEditNote(ctx, note)) {
      return { error: "Only people who can edit the note resolve comments." };
    }
    const result = await ctx.db.noteComment.updateMany({
      where: { id: threadId, noteId, organizationId: ctx.organizationId, threadId: null },
      data: resolved
        ? { resolvedAt: new Date(), resolvedById: ctx.userId, updatedAt: new Date() }
        : { resolvedAt: null, resolvedById: null, updatedAt: new Date() },
    });
    if (result.count === 0) return { error: "That thread no longer exists." };
    return { comments: await freshList(ctx, noteId) };
  },
);

/** Deletes a comment (a thread's first comment takes its replies): its author, or whoever may share the note. */
export const deleteNoteComment = filesAction(
  async (ctx, noteId: string, commentId: string): Promise<CommentsResult> => {
    if (!idSchema.safeParse(commentId).success) return { error: "Invalid input" };
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    const comment = await ctx.db.noteComment.findFirst({
      where: { id: commentId, noteId, organizationId: ctx.organizationId },
      select: { authorId: true },
    });
    if (!comment) return { error: "That comment no longer exists." };
    if (comment.authorId !== ctx.userId && !canShareNote(ctx, note)) {
      return { error: "Only its author, or whoever shares the note, can delete a comment." };
    }
    await ctx.db.noteComment.deleteMany({
      where: { id: commentId, noteId, organizationId: ctx.organizationId },
    });
    return { comments: await freshList(ctx, noteId) };
  },
);

/** The note's comments, for a refresh (another person's new thread). */
export const listCommentsAction = filesAction(
  async (ctx, noteId: string): Promise<CommentsResult> => {
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    return { comments: await freshList(ctx, noteId) };
  },
);
