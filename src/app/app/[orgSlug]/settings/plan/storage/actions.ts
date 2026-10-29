"use server";

import { ForbiddenError } from "@/lib/auth/errors";
import { withOrgAction } from "@/server/db/context";
import { canManageStorage } from "@/server/storage/quota";
import { deleteEmptiedFiles, emptyTrash } from "@/server/storage/usage";

/**
 * Settings › Plan and storage › Storage: Empty trash, the page's one
 * destructive button (owners and admins, or the Personal owner). Notes in
 * the trash are deleted for good (their history with them); files in the
 * trash can't be restored any more and their bytes leave the store after
 * commit. Allowed in a paused club: making room never adds anything.
 */

export interface EmptyTrashResult {
  error?: string;
  notes?: number;
  files?: number;
}

export const emptyTrashAction = withOrgAction(async (ctx): Promise<EmptyTrashResult> => {
  if (!canManageStorage(ctx.role)) throw new ForbiddenError();
  const emptied = await emptyTrash(ctx.db, ctx.organizationId);
  ctx.afterCommit(() => deleteEmptiedFiles(emptied.fileKeys));
  return { notes: emptied.notes, files: emptied.files };
});
