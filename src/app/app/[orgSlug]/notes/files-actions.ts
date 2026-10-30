"use server";

import { z } from "zod";

import { withOrgAction } from "@/server/db/context";
import { removeNoteFile, restoreNoteFile, updateNoteFile } from "@/server/notes/files";
import { getBlob } from "@/server/storage";

/** Every action here belongs to files (withOrgAction's space check). */
const filesAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { ...options, feature: "files" });

/**
 * Uploaded files in Files: the uploader, or an owner or admin (RLS decides which
 * rows the update may touch). Removing moves a file to "Recently deleted";
 * its bytes stay until the maintenance job clears files deleted more than
 * NOTE_TRASH_DAYS ago, so a restore brings it back whole.
 */
export const removeNoteFileAction = filesAction(
  async (ctx, fileId: string): Promise<{ error?: string }> => {
    const key = await removeNoteFile(ctx.db, ctx.organizationId, z.string().max(64).parse(fileId));
    if (!key)
      return { error: "Only the person who uploaded it, or an admin, can delete this file." };
    return {};
  },
);

const deletedFileKey = filesAction(async (ctx, fileId: string): Promise<string | null> => {
  const row = await ctx.db.orgFile.findFirst({
    where: { id: fileId, organizationId: ctx.organizationId, deletedAt: { not: null } },
    select: { storageKey: true },
  });
  return row?.storageKey ?? null;
});

const restoreRow = filesAction(async (ctx, fileId: string): Promise<{ error?: string }> => {
  const ok = await restoreNoteFile(ctx.db, ctx.organizationId, fileId);
  return ok ? {} : { error: "That file can't be restored any more." };
});

/**
 * Brings a file back from "Recently deleted", once its bytes are confirmed
 * to still be there (a file deleted before files waited in the trash lost
 * them at once, and a row without its bytes would only be a broken link).
 * Blob reads stay outside the transaction, so this is three short steps.
 */
export async function restoreNoteFileAction(
  orgId: string,
  fileId: string,
): Promise<{ error?: string }> {
  const id = z.string().max(64).parse(fileId);
  const key = await deletedFileKey(orgId, id);
  if (!key) return { error: "That file can't be restored any more." };
  const blob = await getBlob(key).catch(() => null);
  if (!blob) return { error: "This file's contents are already gone, so it can't be restored." };
  return restoreRow(orgId, id);
}

const filePatch = z
  .object({
    name: z.string().trim().min(1, "Give it a name.").max(200).optional(),
    visibility: z.enum(["PRIVATE", "ORGANIZATION"]).optional(),
  })
  .strict();

/** Renames a file or changes who can see it (its page saves each change as it's made). */
export const updateNoteFileAction = filesAction(
  async (ctx, fileId: string, patch: unknown): Promise<{ error?: string }> => {
    const parsed = filePatch.safeParse(patch);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check that." };
    const ok = await updateNoteFile(
      ctx.db,
      ctx.organizationId,
      z.string().max(64).parse(fileId),
      parsed.data,
    );
    return ok
      ? {}
      : { error: "Only the person who uploaded it, or an admin, can change this file." };
  },
);
