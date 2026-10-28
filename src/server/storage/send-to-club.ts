import type { Prisma } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { withOrgAction, withOrgTx } from "@/server/db/context";

import { deleteBlobs, getBlob, putBlob, randomKeyId } from "./index";
import { checkUpload, confirmFits, crossedWarning, UploadRefusedError, warnStorage } from "./quota";

/**
 * "Send to a club" (redesign guide 11.3): a copy of a note or a file from
 * the caller's Personal space into one of their clubs, shared with the
 * club. The original stays in Personal. The copy is the caller's in the
 * club and counts toward the club's storage: a file goes through the
 * club's upload gate (notes and files on its plan, not paused, the plan's
 * largest file, room left) and the quota is re-checked in the row's
 * transaction, like any upload.
 *
 * Unlike Move to a club (app.move_personal_items, which moves events,
 * polls and tasks keeping their ids), this copies, as the caller under
 * RLS in each space, so it needs nothing new from the database.
 */

export type SendResult = { ok: true; id: string } | { ok: false; error: string };

async function personalOnly(personalId: string): Promise<void> {
  const kind = await withOrgTx(personalId, ({ db }) =>
    db.organization.findUnique({ where: { id: personalId }, select: { kind: true } }),
  );
  if (kind?.kind !== "PERSONAL") throw new NotFoundError();
}

/** Copies a Personal file into `clubId` (a club the caller belongs to). */
export async function sendFileToClub(
  personalId: string,
  fileId: string,
  clubId: string,
): Promise<SendResult> {
  if (personalId === clubId) return { ok: false, error: "Choose one of your organizations." };
  await personalOnly(personalId);
  const file = await withOrgTx(personalId, ({ db }) =>
    db.orgFile.findFirst({
      where: { id: fileId, organizationId: personalId, deletedAt: null },
      select: { name: true, contentType: true, sizeBytes: true, storageKey: true, excerpt: true },
    }),
  );
  if (!file) throw new NotFoundError();
  const refusal = await checkUpload(clubId, file.sizeBytes, { feature: "files" });
  if (refusal) return { ok: false, error: refusal.error };

  const blob = await getBlob(file.storageKey);
  if (!blob) return { ok: false, error: "That file's contents are missing, so it can't be sent." };
  const stored = await putBlob("files", clubId, [randomKeyId()], blob.body, {
    contentType: file.contentType,
  });
  try {
    const id = await withOrgTx(clubId, async ({ db, userId, role }) => {
      const row = await db.orgFile.create({
        data: {
          organizationId: clubId,
          name: file.name,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
          storageKey: stored.key,
          visibility: "ORGANIZATION",
          uploadedById: userId,
          excerpt: file.excerpt,
        },
        select: { id: true },
      });
      const fit = await confirmFits(db, clubId, file.sizeBytes, role);
      if (crossedWarning(fit.space, fit))
        await warnStorage(db, fit.space, fit.after, `file:${row.id}`);
      return row.id;
    });
    return { ok: true, id };
  } catch (error) {
    await deleteBlobs([stored.key]).catch(() => undefined);
    if (error instanceof UploadRefusedError) return { ok: false, error: error.refusal.error };
    throw error;
  }
}

/** The club's side of a note copy: a write, so a paused club or a plan without notes refuses it. */
const createClubNote = withOrgAction(
  async (
    ctx,
    note: {
      title: string;
      contentJson: Prisma.InputJsonValue;
      contentText: string;
      yjsState: Uint8Array<ArrayBuffer> | null;
      icon: string | null;
      layout: "PAGE" | "DOCUMENT";
      paperSize: "LETTER" | "A4";
      headerText: string | null;
      footerText: string | null;
    },
  ) => {
    const row = await ctx.db.note.create({
      data: {
        organizationId: ctx.organizationId,
        ...note,
        visibility: "ORGANIZATION",
        authorId: ctx.userId,
        updatedById: ctx.userId,
      },
      select: { id: true },
    });
    return { ok: true as const, id: row.id };
  },
  { feature: "files", onRefused: "return" },
);

/** Copies a Personal note (its text, layout and live document) into `clubId`, shared with the club. */
export async function sendNoteToClub(
  personalId: string,
  noteId: string,
  clubId: string,
): Promise<SendResult> {
  if (personalId === clubId) return { ok: false, error: "Choose one of your organizations." };
  await personalOnly(personalId);
  const note = await withOrgTx(personalId, ({ db }) =>
    db.note.findFirst({
      where: { id: noteId, organizationId: personalId, deletedAt: null },
      select: {
        title: true,
        contentJson: true,
        contentText: true,
        yjsState: true,
        icon: true,
        layout: true,
        paperSize: true,
        headerText: true,
        footerText: true,
      },
    }),
  );
  if (!note) throw new NotFoundError();
  const result = await createClubNote(clubId, {
    ...note,
    contentJson: note.contentJson as Prisma.InputJsonValue,
    yjsState: note.yjsState ? new Uint8Array(note.yjsState) : null,
  });
  // A refused write comes back as a SpaceRefusal ({ ok: false, error }).
  const refused = result as { ok: boolean; id?: string; error?: string };
  return refused.ok && refused.id
    ? { ok: true, id: refused.id }
    : { ok: false, error: refused.error ?? "That couldn't be sent." };
}
