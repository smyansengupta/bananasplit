import { z } from "zod";

import { TAG_COLORS, tagColorOf, type TagColor } from "@/lib/tag-colors";

import type { TxClient } from "@/server/db/context";

import { noteVisibleWhere } from "./visibility";

/**
 * Notes page folders (NoteFolder): shared by the org, created by any member,
 * changed by their creator or an owner/admin (RLS). Moving a note is an
 * edit of that note, so RLS lets its author or an admin do it; a file moves
 * for its uploader or an admin.
 */

/**
 * A folder takes a colour from the tag palette (lib/tag-colors.ts),
 * the same one event kinds and epics use: all three are a thing somebody
 * named and expects to keep the colour they gave it, and a shelf of
 * folders is easier to find your way around when they are not five shades
 * of one theme.
 */
export const FOLDER_COLORS = TAG_COLORS;
export type FolderColor = TagColor;

export interface FolderRow {
  id: string;
  name: string;
  color: FolderColor | null;
  createdById: string;
  noteCount: number;
  fileCount: number;
}

export const folderNameSchema = z
  .string()
  .transform((s) => s.replace(/\s+/g, " ").trim())
  .pipe(
    z.string().min(1, "Give the folder a name.").max(80, "Keep folder names under 80 characters."),
  );

export async function listFolders(
  db: TxClient,
  orgId: string,
  userId: string,
): Promise<FolderRow[]> {
  const rows = await db.noteFolder.findMany({
    where: { organizationId: orgId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      color: true,
      createdById: true,
      _count: {
        select: {
          notes: { where: { deletedAt: null, ...noteVisibleWhere(userId) } },
          files: { where: { deletedAt: null } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    // Rows saved before the palette hold a chart slot; tagColorOf reads
    // those onto the nearest name, so no folder loses its colour.
    color: tagColorOf(r.color),
    createdById: r.createdById,
    noteCount: r._count.notes,
    fileCount: r._count.files,
  }));
}

/** What a thing in a folder is, for the glyph on its sheet. */
export type FolderPeekType = "note" | "pdf" | "image" | "sheet" | "slides" | "doc" | "file";

/** One thing inside a folder, as its card shows it. */
export interface FolderPeek {
  id: string;
  kind: "note" | "file";
  /** Finer than `kind`: what sort of file, for its glyph. */
  type: FolderPeekType;
  title: string;
  /** When it last changed (a note) or arrived (a file), ISO. */
  at: string;
}

/** A file's sort, from its stored content type, with the name's extension as a fallback. */
export function fileType(contentType: string, name: string): FolderPeekType {
  const ct = contentType.toLowerCase();
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ct === "application/pdf" || ext === "pdf") return "pdf";
  if (ct.startsWith("image/")) return "image";
  if (
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    ct === "text/csv" ||
    ["xlsx", "xls", "csv", "numbers"].includes(ext)
  )
    return "sheet";
  if (
    ct.includes("presentation") ||
    ct.includes("powerpoint") ||
    ["pptx", "ppt", "key"].includes(ext)
  )
    return "slides";
  if (
    ct.includes("word") ||
    ct.startsWith("text/") ||
    ["docx", "doc", "txt", "md", "rtf", "pages"].includes(ext)
  )
    return "doc";
  return "file";
}

/** How many of a folder's newest items its card names. */
export const FOLDER_PEEK = 3;

/**
 * The newest few things in each folder, for the folder cards on Files'
 * Everything: a folder that names what is inside it is one you can find
 * things in without opening.
 *
 * A note only appears if the viewer could open it - the same rule
 * listFolders counts by - so a private note never shows its title on a
 * folder card. Two capped reads for every folder at once, not one per folder.
 */
export async function folderPeeks(
  db: TxClient,
  orgId: string,
  userId: string,
  folderIds: readonly string[],
): Promise<Map<string, FolderPeek[]>> {
  const out = new Map<string, FolderPeek[]>();
  if (folderIds.length === 0) return out;
  const ids = [...folderIds];
  const cap = Math.min(ids.length * FOLDER_PEEK * 4, 400);

  const notes = await db.note.findMany({
    where: {
      organizationId: orgId,
      folderId: { in: ids },
      deletedAt: null,
      ...noteVisibleWhere(userId),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, folderId: true, updatedAt: true },
    take: cap,
  });
  const files = await db.orgFile.findMany({
    where: { organizationId: orgId, folderId: { in: ids }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, contentType: true, folderId: true, createdAt: true },
    take: cap,
  });

  const items = [
    ...notes.map((n) => ({
      folderId: n.folderId!,
      at: n.updatedAt.getTime(),
      peek: {
        id: n.id,
        kind: "note" as const,
        type: "note" as const,
        title: n.title.trim() || "Untitled",
        at: n.updatedAt.toISOString(),
      },
    })),
    ...files.map((f) => ({
      folderId: f.folderId!,
      at: f.createdAt.getTime(),
      peek: {
        id: f.id,
        kind: "file" as const,
        type: fileType(f.contentType, f.name),
        title: f.name,
        at: f.createdAt.toISOString(),
      },
    })),
  ].sort((a, b) => b.at - a.at);

  for (const item of items) {
    const list = out.get(item.folderId) ?? [];
    if (list.length < FOLDER_PEEK) {
      list.push(item.peek);
      out.set(item.folderId, list);
    }
  }
  return out;
}

export type FolderResult = { ok: true; id?: string } | { ok: false; error: string };

export async function createFolder(
  db: TxClient,
  orgId: string,
  userId: string,
  rawName: unknown,
  color: unknown,
): Promise<FolderResult> {
  const name = folderNameSchema.safeParse(rawName);
  if (!name.success)
    return { ok: false, error: name.error.issues[0]?.message ?? "Check the name." };
  const count = await db.noteFolder.count({ where: { organizationId: orgId } });
  if (count >= 100) return { ok: false, error: "That's a lot of folders. Remove one first." };
  const folder = await db.noteFolder.create({
    data: {
      organizationId: orgId,
      name: name.data,
      color: (FOLDER_COLORS as readonly unknown[]).includes(color) ? (color as FolderColor) : null,
      createdById: userId,
      sortOrder: count,
    },
    select: { id: true },
  });
  return { ok: true, id: folder.id };
}

export async function updateFolder(
  db: TxClient,
  orgId: string,
  folderId: string,
  patch: { name?: unknown; color?: unknown },
): Promise<FolderResult> {
  const data: { name?: string; color?: FolderColor | null } = {};
  if (patch.name !== undefined) {
    const name = folderNameSchema.safeParse(patch.name);
    if (!name.success)
      return { ok: false, error: name.error.issues[0]?.message ?? "Check the name." };
    data.name = name.data;
  }
  if (patch.color !== undefined) {
    data.color = (FOLDER_COLORS as readonly unknown[]).includes(patch.color)
      ? (patch.color as FolderColor)
      : null;
  }
  const { count } = await db.noteFolder.updateMany({
    where: { id: folderId, organizationId: orgId },
    data,
  });
  return count > 0
    ? { ok: true }
    : { ok: false, error: "Only whoever made this folder, or an admin, can change it." };
}

export async function deleteFolder(
  db: TxClient,
  orgId: string,
  folderId: string,
): Promise<FolderResult> {
  const { count } = await db.noteFolder.deleteMany({
    where: { id: folderId, organizationId: orgId },
  });
  return count > 0
    ? { ok: true }
    : { ok: false, error: "Only whoever made this folder, or an admin, can delete it." };
}

/** Moves notes and files into a folder (or out of any, with null). */
export async function moveToFolder(
  db: TxClient,
  orgId: string,
  items: { noteIds?: readonly string[]; fileIds?: readonly string[] },
  folderId: string | null,
): Promise<FolderResult> {
  if (folderId) {
    const folder = await db.noteFolder.findFirst({
      where: { id: folderId, organizationId: orgId },
      select: { id: true },
    });
    if (!folder) return { ok: false, error: "That folder no longer exists." };
  }
  const noteIds = [...(items.noteIds ?? [])].slice(0, 100);
  const fileIds = [...(items.fileIds ?? [])].slice(0, 100);
  let moved = 0;
  if (noteIds.length) {
    moved += (
      await db.note.updateMany({
        where: { id: { in: noteIds }, organizationId: orgId, deletedAt: null },
        data: { folderId },
      })
    ).count;
  }
  if (fileIds.length) {
    moved += (
      await db.orgFile.updateMany({
        where: { id: { in: fileIds }, organizationId: orgId, deletedAt: null },
        data: { folderId },
      })
    ).count;
  }
  if (moved === 0) {
    return {
      ok: false,
      error: "Only a note's author (or a file's uploader), or an admin, can move it.",
    };
  }
  return { ok: true };
}
