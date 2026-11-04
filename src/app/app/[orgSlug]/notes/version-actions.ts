"use server";

import { z } from "zod";

import { collabConfig } from "@/lib/collab/config";
import {
  applyContentToState,
  checkNoteContent,
  InvalidNoteContentError,
  seedNoteState,
} from "@/lib/collab/note-doc";
import { canEditNote, canShareNote } from "@/lib/notes/access";
import { VERSION_NAME_MAX } from "@/lib/notes/history";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { loadNote } from "@/server/notes/load";
import { listNoteVersions } from "@/server/notes/versions";

/**
 * Version history (Moonstone 13.3; NoteVersion). As app_user, so RLS
 * repeats the rules: whoever can see the note lists and opens versions;
 * whoever may edit it names the current version and renames one (name is
 * the only column a member may change); whoever may share it deletes one.
 * Autosave snapshots are the save paths' (src/server/notes/versions.ts).
 *
 * Restoring is an edit: the version's body replaces the current one (kept
 * first as a snapshot, so a restore can be undone from the same list). On
 * the autosave path this action writes it, version-checked like any save;
 * in a live note the editor applies it to the shared document instead, so
 * everyone in the note merges it (writing it here as well would apply it
 * twice).
 */

const filesAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { onRefused: "return", ...options, feature: "files" });

const NOT_FOUND = "Note not found.";
const NO_EDIT = "You don't have permission to edit this note.";
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");
const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the version a name.")
  .max(VERSION_NAME_MAX, `Keep the name under ${VERSION_NAME_MAX} characters.`);

export interface VersionListItem {
  id: string;
  name: string | null;
  createdAt: string;
  sizeBytes: number;
  createdBy: { id: string; name: string | null; image: string | null } | null;
}

export interface VersionsResult {
  error?: string;
  versions?: VersionListItem[];
}

async function freshList(ctx: OrgContext, noteId: string): Promise<VersionListItem[]> {
  return (await listNoteVersions(ctx.db, ctx.organizationId, noteId)).map((v) => ({
    ...v,
    createdAt: v.createdAt.toISOString(),
  }));
}

export const listVersionsAction = filesAction(
  async (ctx, noteId: string): Promise<VersionsResult> => {
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    return { versions: await freshList(ctx, noteId) };
  },
);

/** One version's body, for the preview and the comparison. */
export const getNoteVersion = filesAction(
  async (
    ctx,
    noteId: string,
    versionId: string,
  ): Promise<{ error?: string; contentJson?: unknown; name?: string | null }> => {
    if (!idSchema.safeParse(versionId).success) return { error: "Invalid input" };
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    const version = await ctx.db.noteVersion.findFirst({
      where: { id: versionId, noteId, organizationId: ctx.organizationId },
      select: { contentJson: true, name: true },
    });
    if (!version) return { error: "That version no longer exists." };
    return { contentJson: version.contentJson, name: version.name };
  },
);

/**
 * Names the note as it is now. `contentJson` is the editor's body (a live
 * note's is a few seconds ahead of the stored one), checked against the
 * note schema; without it, the stored body.
 */
export const saveNamedVersion = filesAction(
  async (
    ctx,
    noteId: string,
    name: unknown,
    contentJson?: string | null,
  ): Promise<VersionsResult> => {
    const parsedName = nameSchema.safeParse(name);
    if (!parsedName.success) return { error: parsedName.error.issues[0]?.message };
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    if (!canEditNote(ctx, note)) return { error: NO_EDIT };
    let body: unknown = note.contentJson;
    if (typeof contentJson === "string") {
      if (contentJson.length > 2_000_000) return { error: "That note is too large to save." };
      try {
        body = checkNoteContent(JSON.parse(contentJson)).json;
      } catch (error) {
        if (error instanceof SyntaxError || error instanceof InvalidNoteContentError) {
          return { error: "Invalid note content." };
        }
        throw error;
      }
    }
    await ctx.db.noteVersion.create({
      data: {
        organizationId: ctx.organizationId,
        noteId,
        name: parsedName.data,
        createdById: ctx.userId,
        contentJson: body as object,
      },
    });
    return { versions: await freshList(ctx, noteId) };
  },
);

/** Renames a version (or names an autosave snapshot, which then is kept). */
export const renameNoteVersion = filesAction(
  async (ctx, noteId: string, versionId: string, name: unknown): Promise<VersionsResult> => {
    const parsedName = nameSchema.safeParse(name);
    if (!parsedName.success) return { error: parsedName.error.issues[0]?.message };
    if (!idSchema.safeParse(versionId).success) return { error: "Invalid input" };
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    if (!canEditNote(ctx, note)) return { error: NO_EDIT };
    const result = await ctx.db.noteVersion.updateMany({
      where: { id: versionId, noteId, organizationId: ctx.organizationId },
      data: { name: parsedName.data },
    });
    if (result.count === 0) return { error: "That version no longer exists." };
    return { versions: await freshList(ctx, noteId) };
  },
);

export const deleteNoteVersion = filesAction(
  async (ctx, noteId: string, versionId: string): Promise<VersionsResult> => {
    if (!idSchema.safeParse(versionId).success) return { error: "Invalid input" };
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    if (!canShareNote(ctx, note)) {
      return {
        error: "Only the note's author (or an admin, on an organization note) deletes versions.",
      };
    }
    await ctx.db.noteVersion.deleteMany({
      where: { id: versionId, noteId, organizationId: ctx.organizationId },
    });
    return { versions: await freshList(ctx, noteId) };
  },
);

export interface RestoreResult extends VersionsResult {
  /** The restored body, for the editor. */
  contentJson?: unknown;
  /** The note's version after an autosave-path restore. */
  version?: number;
  conflict?: boolean;
}

/**
 * Restores a version. `live`: the editor is in a live session and applies
 * the body itself; otherwise this writes it, checked against
 * `expectedVersion` like an autosave.
 */
export const restoreNoteVersion = filesAction(
  async (
    ctx,
    noteId: string,
    versionId: string,
    options: { live: boolean; expectedVersion?: number },
  ): Promise<RestoreResult> => {
    if (!idSchema.safeParse(versionId).success) return { error: "Invalid input" };
    const note = await loadNote(ctx, noteId);
    if (!note) return { error: NOT_FOUND };
    if (!canEditNote(ctx, note)) return { error: NO_EDIT };
    const version = await ctx.db.noteVersion.findFirst({
      where: { id: versionId, noteId, organizationId: ctx.organizationId },
      select: { contentJson: true, createdAt: true, name: true },
    });
    if (!version) return { error: "That version no longer exists." };
    let content;
    try {
      content = checkNoteContent(version.contentJson);
    } catch (error) {
      if (error instanceof InvalidNoteContentError) {
        return { error: "That version can't be restored: its content no longer fits." };
      }
      throw error;
    }

    // What it replaces, so the restore can be undone.
    if (note.contentText.trim()) {
      await ctx.db.noteVersion.create({
        data: {
          organizationId: ctx.organizationId,
          noteId,
          name: null,
          createdById: ctx.userId,
          contentJson: note.contentJson as object,
        },
      });
    }

    if (options?.live) {
      return { contentJson: content.json, versions: await freshList(ctx, noteId) };
    }

    const expected = options?.expectedVersion ?? note.version;
    const base = note.yjsState
      ? new Uint8Array(note.yjsState)
      : collabConfig()
        ? seedNoteState(note.contentJson)
        : null;
    const yjsState = base ? applyContentToState(base, content.json) : null;
    const result = await ctx.db.note.updateMany({
      where: { id: noteId, organizationId: ctx.organizationId, version: expected },
      data: {
        contentJson: content.json as object,
        contentText: content.text,
        updatedById: ctx.userId,
        version: { increment: 1 },
        ...(yjsState ? { yjsState: new Uint8Array(yjsState) } : {}),
      },
    });
    if (result.count === 0) {
      return { error: "This note was updated by someone else — reload.", conflict: true };
    }
    return {
      contentJson: content.json,
      version: expected + 1,
      versions: await freshList(ctx, noteId),
    };
  },
);
