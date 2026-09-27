import {
  InvalidNoteContentError,
  noteStateToContent,
  reconcileNoteState,
  sameContent,
  seedNoteState,
} from "@/lib/collab/note-doc";
import { canEditNote, isNoteVisibleTo } from "@/lib/notes/access";
import type { MemberContext } from "@/server/db/context";

/**
 * Loading and saving a note's live document for the collaboration bridge
 * (src/app/api/collab, docs/features/collaboration.md).
 *
 * Both run in the acting user's own RLS context (withOrgTxAs), so the
 * database applies the note policies (6.8) to a live save exactly as to an
 * autosave: a PRIVATE note is invisible to everyone but its author, and only
 * the author or an OWNER/ADMIN may write. The same two rules are checked
 * here first for a clear answer. The acting user of a store is the last
 * writer of the batch; their permission is checked again at every save, so
 * a demotion or removal stops their saves at once (their token also expires
 * within minutes).
 *
 * A save writes contentJson and contentText (so search, the notes list and
 * the autosave editor see the live body), the Yjs state, updatedById and a
 * version bump (so an autosave editor opened on the old version gets the
 * usual "updated by someone else" conflict instead of overwriting).
 */

/** The note's Yjs state for the collaboration server, or null if the user cannot see it. */
export async function loadNoteState(
  ctx: MemberContext,
  noteId: string,
): Promise<Uint8Array | null> {
  const note = await ctx.db.note.findFirst({
    where: { id: noteId, organizationId: ctx.organizationId, deletedAt: null },
    select: { authorId: true, visibility: true, contentJson: true, yjsState: true },
  });
  if (!note || !isNoteVisibleTo(ctx.userId, note)) return null;
  return note.yjsState ? new Uint8Array(note.yjsState) : seedNoteState(note.contentJson);
}

export type StoreResult =
  | {
      ok: true;
      /** The version after the save, or null when the body had not changed. */
      version: number | null;
      /** What the live document is missing (an autosave merged in), or null. */
      missing: Uint8Array | null;
    }
  | { ok: false; reason: "not_found" | "forbidden" | "invalid" | "conflict" };

/** Reads and writes before giving up on a row that keeps changing underneath (409). */
const STORE_ATTEMPTS = 3;

/** Saves `incoming` (the whole live document) into the note, merged with what the row holds. */
export async function storeNoteState(
  ctx: MemberContext,
  noteId: string,
  incoming: Uint8Array,
): Promise<StoreResult> {
  for (let attempt = 0; attempt < STORE_ATTEMPTS; attempt++) {
    const note = await ctx.db.note.findFirst({
      where: { id: noteId, organizationId: ctx.organizationId, deletedAt: null },
      select: {
        authorId: true,
        visibility: true,
        contentJson: true,
        yjsState: true,
        version: true,
      },
    });
    if (!note || !isNoteVisibleTo(ctx.userId, note)) return { ok: false, reason: "not_found" };
    if (!canEditNote(ctx, note)) return { ok: false, reason: "forbidden" };

    const { state, missing } = reconcileNoteState(incoming, {
      yjsState: note.yjsState ? new Uint8Array(note.yjsState) : null,
      contentJson: note.contentJson,
    });
    let content;
    try {
      content = noteStateToContent(state);
    } catch (error) {
      if (error instanceof InvalidNoteContentError) return { ok: false, reason: "invalid" };
      throw error;
    }

    // The same body (typed and deleted again, or a reconnect's resync): no
    // write, no version bump. The row's state stays an ancestor of the live
    // one, which is all a later merge needs.
    if (sameContent(content.json, note.contentJson)) return { ok: true, version: null, missing };

    // The version guards the read-merge-write: if an autosave or another
    // live save landed in between, read again and merge that too.
    const result = await ctx.db.note.updateMany({
      where: { id: noteId, organizationId: ctx.organizationId, version: note.version },
      data: {
        contentJson: content.json as object,
        contentText: content.text,
        yjsState: new Uint8Array(state),
        updatedById: ctx.userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 1) return { ok: true, version: note.version + 1, missing };
  }
  return { ok: false, reason: "conflict" };
}
