"use server";

import { z } from "zod";

import { withOrgAction } from "@/server/db/context";
import {
  createFolder,
  deleteFolder,
  moveToFolder,
  updateFolder,
  type FolderResult,
} from "@/server/notes/folders";

/** Notes page folders: every write runs as the member, under RLS. */

const id = z.string().min(1).max(64);

export const createFolderAction = withOrgAction(
  async (ctx, name: unknown, color: unknown): Promise<FolderResult> =>
    createFolder(ctx.db, ctx.organizationId, ctx.userId, name, color),
);

export const updateFolderAction = withOrgAction(
  async (ctx, folderId: string, patch: { name?: unknown; color?: unknown }): Promise<FolderResult> =>
    updateFolder(ctx.db, ctx.organizationId, id.parse(folderId), patch ?? {}),
);

export const deleteFolderAction = withOrgAction(
  async (ctx, folderId: string): Promise<FolderResult> => deleteFolder(ctx.db, ctx.organizationId, id.parse(folderId)),
);

export const moveToFolderAction = withOrgAction(
  async (
    ctx,
    items: { noteIds?: string[]; fileIds?: string[] },
    folderId: string | null,
  ): Promise<FolderResult> => {
    const parsed = z
      .object({ noteIds: z.array(id).max(100).optional(), fileIds: z.array(id).max(100).optional() })
      .safeParse(items);
    if (!parsed.success) return { ok: false, error: "Nothing to move." };
    return moveToFolder(ctx.db, ctx.organizationId, parsed.data, folderId ? id.parse(folderId) : null);
  },
);
