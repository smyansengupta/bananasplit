"use server";

import { z } from "zod";

import { NoteVisibility } from "@/generated/prisma/client";
import { collabConfig } from "@/lib/collab/config";
import { applyContentToState, InvalidNoteContentError, seedNoteState } from "@/lib/collab/note-doc";
import { canEditNote, isNoteVisibleTo } from "@/lib/notes/access";
import { revokeNoteSessions } from "@/server/collab/revoke";
import { mintNoteCollabSession, type NoteCollabSession } from "@/server/collab/session";
import { withOrgAction, type OrgContext } from "@/server/db/context";

/**
 * Note actions (0C). Each runs in one withOrgAction transaction as app_user,
 * so RLS repeats the rules checked here: PRIVATE notes are visible only to
 * their author, and only the author or an OWNER/ADMIN may edit or delete a
 * note (policy 6.8, immutable authorId). Error semantics: every action
 * returns its { error } before its single write, so nothing commits on an
 * error path.
 *
 * Live collaboration (docs/features/collaboration.md) adds three things:
 * issueNoteCollabToken; updateNoteDetails, the live editor's save for the
 * title, visibility and event (its body saves through the collaboration
 * server); and in updateNote, keeping a note's Yjs state in step with an
 * autosave, so a live session merges the autosave instead of losing it.
 */

const NOTE_VISIBILITY_VALUES = Object.values(NoteVisibility) as [
  NoteVisibility,
  ...NoteVisibility[],
];

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

const titleSchema = z.string().trim().min(1, "Title is required").max(300);

const noteUpdateSchema = z.object({
  title: titleSchema,
  // JSON-encoded ProseMirror document, not a plain object: passing the raw
  // object as a Server Action argument intermittently fails ("temporary
  // client reference") for large/deeply nested payloads, so the client
  // stringifies it and this parses it back after validation.
  contentJson: z.string().max(2_000_000),
  contentText: z.string().max(200_000),
  visibility: z.enum(NOTE_VISIBILITY_VALUES),
  eventId: z.string().nullable(),
});

export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>;

/** A partial update of everything but the body (the live editor's metadata save). */
const noteDetailsSchema = z.object({
  title: titleSchema.optional(),
  visibility: z.enum(NOTE_VISIBILITY_VALUES).optional(),
  eventId: z.string().nullable().optional(),
});

export type NoteDetailsInput = z.infer<typeof noteDetailsSchema>;

interface ActionResult {
  error?: string;
  conflict?: boolean;
  noteId?: string;
  version?: number;
}

async function assertEventBelongsToOrg(ctx: OrgContext, eventId: string | null) {
  if (!eventId) return null;
  const event = await ctx.db.event.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true },
  });
  return event ? null : "That event doesn't exist in this organization.";
}

/**
 * A note leaving everyone else's view (turned PRIVATE, or deleted): close
 * its live sessions after commit, so other editors reconnect and are refused.
 */
function revokeAfterCommit(ctx: OrgContext, noteId: string) {
  ctx.afterCommit(() => revokeNoteSessions(ctx.organizationId, noteId));
}

export const createNote = withOrgAction(
  async (ctx, prefill?: { title?: string; eventId?: string }): Promise<ActionResult> => {
    if (prefill?.eventId) {
      const eventError = await assertEventBelongsToOrg(ctx, prefill.eventId);
      if (eventError) return { error: eventError };
    }

    const note = await ctx.db.note.create({
      data: {
        organizationId: ctx.organizationId,
        title: prefill?.title?.trim() || "Untitled note",
        contentJson: EMPTY_DOC,
        contentText: "",
        visibility: NoteVisibility.PRIVATE,
        authorId: ctx.userId,
        updatedById: ctx.userId,
        eventId: prefill?.eventId ?? null,
      },
      select: { id: true },
    });
    return { noteId: note.id };
  },
);

const importSchema = z.object({
  title: titleSchema,
  contentJson: z.string().max(2_000_000),
  contentText: z.string().max(200_000),
  folderId: z.string().max(64).nullable().optional(),
  visibility: z.enum(NOTE_VISIBILITY_VALUES).optional(),
});

/**
 * A note made from an imported Word document or Google Doc: the browser
 * turned the document into the editor's JSON; it is checked against the
 * note schema here (the same check a live edit gets) before it is stored.
 * Imported notes (and ones started from a template) start PRIVATE unless
 * the member picked otherwise, optionally in a folder.
 */
export const importNote = withOrgAction(async (ctx, input: unknown): Promise<ActionResult> => {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  let contentJson: object;
  let state: Uint8Array;
  try {
    contentJson = JSON.parse(parsed.data.contentJson);
    state = applyContentToState(seedNoteState(EMPTY_DOC), contentJson);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof InvalidNoteContentError) {
      return { error: "That document couldn't be turned into a note." };
    }
    throw error;
  }
  const folderId = parsed.data.folderId ?? null;
  if (folderId) {
    const folder = await ctx.db.noteFolder.findFirst({
      where: { id: folderId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!folder) return { error: "That folder no longer exists." };
  }
  const note = await ctx.db.note.create({
    data: {
      organizationId: ctx.organizationId,
      title: parsed.data.title,
      contentJson,
      contentText: parsed.data.contentText,
      visibility: parsed.data.visibility ?? NoteVisibility.PRIVATE,
      folderId,
      authorId: ctx.userId,
      updatedById: ctx.userId,
      ...(collabConfig() ? { yjsState: new Uint8Array(state) } : {}),
    },
    select: { id: true },
  });
  return { noteId: note.id };
});

export const updateNote = withOrgAction(
  async (ctx, noteId: string, input: unknown, expectedVersion: number): Promise<ActionResult> => {
    const existing = await ctx.db.note.findFirst({
      where: { id: noteId, organizationId: ctx.organizationId, deletedAt: null },
    });
    if (!existing || !isNoteVisibleTo(ctx.userId, existing)) {
      return { error: "Note not found." };
    }
    if (!canEditNote(ctx, existing)) {
      return { error: "You don't have permission to edit this note." };
    }

    const parsed = noteUpdateSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    let contentJson: object;
    try {
      contentJson = JSON.parse(data.contentJson);
    } catch {
      return { error: "Invalid note content." };
    }

    // A note with a Yjs state (it has been edited live) gets this autosave
    // applied to that state as an edit, so a live session merges it rather
    // than loses it. With collaboration on, a note without one gets its
    // state now (seeded from the content this save replaces), for the same
    // reason. With collaboration off and no state, nothing changes here.
    let yjsState: Uint8Array | undefined;
    const base = existing.yjsState
      ? new Uint8Array(existing.yjsState)
      : collabConfig()
        ? seedNoteState(existing.contentJson)
        : null;
    if (base) {
      try {
        yjsState = applyContentToState(base, contentJson);
      } catch (error) {
        if (error instanceof InvalidNoteContentError) return { error: "Invalid note content." };
        throw error;
      }
    }

    const eventError = await assertEventBelongsToOrg(ctx, data.eventId);
    if (eventError) return { error: eventError };

    const result = await ctx.db.note.updateMany({
      where: { id: noteId, organizationId: ctx.organizationId, version: expectedVersion },
      data: {
        title: data.title,
        contentJson,
        contentText: data.contentText,
        visibility: data.visibility,
        eventId: data.eventId,
        updatedById: ctx.userId,
        version: { increment: 1 },
        ...(yjsState ? { yjsState: new Uint8Array(yjsState) } : {}),
      },
    });

    if (result.count === 0) {
      return { error: "This note was updated by someone else — reload.", conflict: true };
    }

    if (
      existing.visibility !== NoteVisibility.PRIVATE &&
      data.visibility === NoteVisibility.PRIVATE
    ) {
      revokeAfterCommit(ctx, noteId);
    }
    return { noteId, version: expectedVersion + 1 };
  },
);

/**
 * The live editor's save for the title, visibility and linked event: only
 * the fields given, no version check (the body merges through the
 * collaboration server, so there is no stale body to protect; last writer
 * wins per field). Bumps the version, so an autosave editor still open on
 * the old one gets the usual conflict instead of overwriting these.
 */
export const updateNoteDetails = withOrgAction(
  async (ctx, noteId: string, input: unknown): Promise<ActionResult> => {
    const existing = await ctx.db.note.findFirst({
      where: { id: noteId, organizationId: ctx.organizationId, deletedAt: null },
      select: { authorId: true, visibility: true },
    });
    if (!existing || !isNoteVisibleTo(ctx.userId, existing)) {
      return { error: "Note not found." };
    }
    if (!canEditNote(ctx, existing)) {
      return { error: "You don't have permission to edit this note." };
    }

    const parsed = noteDetailsSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const patch = parsed.data;
    if (patch.eventId !== undefined) {
      const eventError = await assertEventBelongsToOrg(ctx, patch.eventId);
      if (eventError) return { error: eventError };
    }

    const result = await ctx.db.note.updateMany({
      where: { id: noteId, organizationId: ctx.organizationId },
      data: { ...patch, updatedById: ctx.userId, version: { increment: 1 } },
    });
    if (result.count === 0) return { error: "Note not found." };

    if (
      existing.visibility !== NoteVisibility.PRIVATE &&
      patch.visibility === NoteVisibility.PRIVATE
    ) {
      revokeAfterCommit(ctx, noteId);
    }
    return { noteId };
  },
);

export type CollabTokenResult = { session: NoteCollabSession; error?: never } | { error: string };

/**
 * A fresh collaboration token for a note (the editor asks on every
 * connection and before its token expires). Minted only after the note was
 * read back through RLS as the caller, so access that was lost since the
 * last token (the note turned PRIVATE, the caller left the org) is refused
 * here; write permission is canEditNote's.
 */
export const issueNoteCollabToken = withOrgAction(
  async (ctx, noteId: string): Promise<CollabTokenResult> => {
    const config = collabConfig();
    if (!config) return { error: "Live editing is off." };

    const note = await ctx.db.note.findFirst({
      where: { id: noteId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, authorId: true, visibility: true },
    });
    if (!note || !isNoteVisibleTo(ctx.userId, note)) return { error: "Note not found." };
    return { session: mintNoteCollabSession(config, ctx, note) };
  },
);

export const deleteNote = withOrgAction(async (ctx, noteId: string): Promise<ActionResult> => {
  const existing = await ctx.db.note.findFirst({
    where: { id: noteId, organizationId: ctx.organizationId, deletedAt: null },
  });
  if (!existing || !isNoteVisibleTo(ctx.userId, existing)) {
    return { error: "Note not found." };
  }
  if (!canEditNote(ctx, existing)) {
    return { error: "You don't have permission to delete this note." };
  }

  await ctx.db.note.updateMany({
    where: { id: noteId, organizationId: ctx.organizationId },
    data: { deletedAt: new Date() },
  });
  revokeAfterCommit(ctx, noteId);
  return {};
});

export const restoreNote = withOrgAction(async (ctx, noteId: string): Promise<ActionResult> => {
  const existing = await ctx.db.note.findFirst({
    where: { id: noteId, organizationId: ctx.organizationId },
  });
  if (!existing || !isNoteVisibleTo(ctx.userId, existing)) {
    return { error: "Note not found." };
  }
  if (!canEditNote(ctx, existing)) {
    return { error: "You don't have permission to restore this note." };
  }

  await ctx.db.note.updateMany({
    where: { id: noteId, organizationId: ctx.organizationId },
    data: { deletedAt: null },
  });
  return {};
});
