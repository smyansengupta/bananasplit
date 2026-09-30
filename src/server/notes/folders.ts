import { z } from "zod";

import type { TxClient } from "@/server/db/context";

/**
 * Notes page folders (NoteFolder): shared by the org, created by any member,
 * changed by their creator or an owner/admin (RLS). Moving a note is an
 * edit of that note, so RLS lets its author or an admin do it; a file moves
 * for its uploader or an admin.
 */

export const FOLDER_COLORS = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] as const;
export type FolderColor = (typeof FOLDER_COLORS)[number];

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
  .pipe(z.string().min(1, "Give the folder a name.").max(80, "Keep folder names under 80 characters."));

export async function listFolders(db: TxClient, orgId: string, userId: string): Promise<FolderRow[]> {
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
          notes: { where: { deletedAt: null, OR: [{ visibility: "ORGANIZATION" }, { authorId: userId }] } },
          files: { where: { deletedAt: null } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: (FOLDER_COLORS as readonly string[]).includes(r.color ?? "") ? (r.color as FolderColor) : null,
    createdById: r.createdById,
    noteCount: r._count.notes,
    fileCount: r._count.files,
  }));
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
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message ?? "Check the name." };
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
    if (!name.success) return { ok: false, error: name.error.issues[0]?.message ?? "Check the name." };
    data.name = name.data;
  }
  if (patch.color !== undefined) {
    data.color = (FOLDER_COLORS as readonly unknown[]).includes(patch.color) ? (patch.color as FolderColor) : null;
  }
  const { count } = await db.noteFolder.updateMany({ where: { id: folderId, organizationId: orgId }, data });
  return count > 0 ? { ok: true } : { ok: false, error: "Only whoever made this folder, or an admin, can change it." };
}

export async function deleteFolder(db: TxClient, orgId: string, folderId: string): Promise<FolderResult> {
  const { count } = await db.noteFolder.deleteMany({ where: { id: folderId, organizationId: orgId } });
  return count > 0 ? { ok: true } : { ok: false, error: "Only whoever made this folder, or an admin, can delete it." };
}

/** Moves notes and files into a folder (or out of any, with null). */
export async function moveToFolder(
  db: TxClient,
  orgId: string,
  items: { noteIds?: readonly string[]; fileIds?: readonly string[] },
  folderId: string | null,
): Promise<FolderResult> {
  if (folderId) {
    const folder = await db.noteFolder.findFirst({ where: { id: folderId, organizationId: orgId }, select: { id: true } });
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
    return { ok: false, error: "Only a note's author (or a file's uploader), or an admin, can move it." };
  }
  return { ok: true };
}
