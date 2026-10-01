"use server";

import { z } from "zod";

import { withOrgAction } from "@/server/db/context";
import { removeNoteFile } from "@/server/notes/files";
import { deleteBlobs } from "@/server/storage";

/**
 * Removes a Notes page file: the uploader, or an owner or admin (RLS decides
 * which rows the update may touch). The blob goes after the row commits.
 */
export const removeNoteFileAction = withOrgAction(
  async (ctx, fileId: string): Promise<{ error?: string }> => {
    const key = await removeNoteFile(ctx.db, ctx.organizationId, z.string().max(64).parse(fileId));
    if (!key) return { error: "Only the person who uploaded it, or an admin, can remove this file." };
    ctx.afterCommit(() => deleteBlobs([key]));
    return {};
  },
);
