import { NoteLayout, NoteVisibility } from "@/generated/prisma/client";
import { collabConfig } from "@/lib/collab/config";
import { applyContentToState, seedNoteState, type NoteContent } from "@/lib/collab/note-doc";
import type { OrgContext } from "@/server/db/context";

import { loadNote } from "./load";

/**
 * A new note, from the notes page's New note (and a page's subpage, an
 * event's "Add notes") and from the AI connectors' create_note
 * (src/server/connectors). It runs in the caller's withOrgAction-style
 * transaction as app_user, so RLS repeats every rule here. Errors come back
 * as { error } before the first write, so nothing commits on an error path.
 *
 * A note starts PRIVATE, or with the general access of the page it sits
 * inside (a page inside a club page is a club page); the people a private
 * page is shared with are not copied. A body, when given, has already been
 * checked against the note schema (checkNoteContent); with live
 * collaboration on it is stored as Yjs state too, as an imported note's is.
 */

/** An empty body, as the editor starts one. */
export const EMPTY_NOTE_DOC = { type: "doc", content: [{ type: "paragraph" }] };

const NOTE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface NewNote {
  title?: string;
  /** The event the note is about (an event's "Add notes"). */
  eventId?: string | null;
  /** The page it goes inside. */
  parentId?: string | null;
  folderId?: string | null;
  /** The body, checked against the note schema; empty unless given. */
  content?: NoteContent;
}

export interface CreateNoteResult {
  error?: string;
  noteId?: string;
}

/** Null when the event is this org's (or there is none), else the error to return. */
export async function assertEventBelongsToOrg(ctx: OrgContext, eventId: string | null) {
  if (!eventId) return null;
  const event = await ctx.db.event.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true },
  });
  return event ? null : "That event doesn't exist in this organization.";
}

/** The page a new note goes inside, or an error: one the caller can see. */
export async function parentFor(ctx: OrgContext, parentId: string | null | undefined) {
  if (!parentId) return { parent: null };
  if (!NOTE_ID.test(parentId)) return { error: "Note not found." };
  const parent = await loadNote(ctx, parentId);
  if (!parent) return { error: "That page no longer exists." };
  return { parent };
}

export async function createNote(ctx: OrgContext, input: NewNote = {}): Promise<CreateNoteResult> {
  if (input.eventId) {
    const eventError = await assertEventBelongsToOrg(ctx, input.eventId);
    if (eventError) return { error: eventError };
  }
  const { parent, error } = await parentFor(ctx, input.parentId);
  if (error) return { error };
  const folderId = input.folderId ?? null;
  if (folderId) {
    const folder = await ctx.db.noteFolder.findFirst({
      where: { id: folderId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!folder) return { error: "That folder no longer exists." };
  }

  const content = input.content;
  const note = await ctx.db.note.create({
    data: {
      organizationId: ctx.organizationId,
      title: input.title?.trim() || "Untitled note",
      contentJson: content?.json ?? EMPTY_NOTE_DOC,
      contentText: content?.text ?? "",
      visibility: parent?.visibility ?? NoteVisibility.PRIVATE,
      memberCanEdit: parent?.visibility === NoteVisibility.ORGANIZATION && parent.memberCanEdit,
      authorId: ctx.userId,
      updatedById: ctx.userId,
      eventId: input.eventId ?? null,
      parentId: parent?.id ?? null,
      layout: parent?.layout ?? NoteLayout.PAGE,
      ...(folderId ? { folderId } : {}),
      ...(content && collabConfig()
        ? {
            yjsState: new Uint8Array(
              applyContentToState(seedNoteState(EMPTY_NOTE_DOC), content.json),
            ),
          }
        : {}),
    },
    select: { id: true },
  });
  return { noteId: note.id };
}
