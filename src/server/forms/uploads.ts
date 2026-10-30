import { sniffNoteFile } from "@/lib/files/types";
import { readQuestions } from "@/lib/forms/questions";
import { withSystemOrgTx } from "@/server/db/context";
import { deleteBlobs, putBlob, randomKeyId } from "@/server/storage";
import { confirmFits, UploadRefusedError } from "@/server/storage/quota";

import { FORM_SELECT, isFormOpen } from "./forms";
import type { FormTarget, Respondent } from "./public";

/**
 * A file sent with a form answer (a resume, a photo): stored in the club's
 * Files, in the folder the form was made with, credited to the form's
 * creator (the respondent may have no account), and counted toward the
 * club's storage like any upload: confirmFits re-checks the counter in the
 * row's own transaction and refuses (rolling back) when the space is full.
 * The answer holds the file's id; submitting turns it into a link.
 */

export class FormUploadError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export async function storeFormUpload(
  target: FormTarget,
  questionId: string,
  file: { bytes: Buffer; filename: string },
  who: Respondent,
): Promise<{ id: string; name: string }> {
  const form = await withSystemOrgTx(target.organizationId, async ({ db }) => {
    const row = await db.form.findFirst({
      where: { id: target.formId, organizationId: target.organizationId, deletedAt: null },
      select: FORM_SELECT,
    });
    if (!row) return null;
    const responses = await db.formResponse.count({
      where: { organizationId: row.organizationId, formId: row.id },
    });
    const member =
      who.userId && row.access === "MEMBERS"
        ? await db.membership.count({
            where: { organizationId: row.organizationId, userId: who.userId },
          })
        : 1;
    return { row, open: isFormOpen(row, responses), member: member > 0 };
  });
  if (!form || !form.open) throw new FormUploadError("This form isn't taking answers.", 404);
  if (form.row.access !== "ANYONE" && !who.userId)
    throw new FormUploadError("Sign in to answer this form.", 401);
  if (!form.member) throw new FormUploadError("Only members can answer this form.", 403);
  if (!form.row.folderId) throw new FormUploadError("This form can't take files.", 409);
  const question = readQuestions(form.row.questions).find((q) => q.id === questionId);
  if (!question || (question.type !== "file" && question.type !== "image"))
    throw new FormUploadError("That question doesn't take a file.");

  const contentType = sniffNoteFile(file.bytes, file.filename);
  if (!contentType)
    throw new FormUploadError(
      "That kind of file isn't accepted. Try a PDF, a document or an image.",
      415,
    );
  if (question.type === "image" && !contentType.startsWith("image/"))
    throw new FormUploadError("Send a picture: JPEG, PNG or WebP.", 415);

  const stored = await putBlob("files", target.organizationId, [randomKeyId()], file.bytes, {
    contentType,
  });
  try {
    return await withSystemOrgTx(target.organizationId, async ({ db }) => {
      const row = await db.orgFile.create({
        data: {
          organizationId: target.organizationId,
          name:
            file.filename
              .replace(/[\\/:*?"<>|]+/g, " ")
              .trim()
              .slice(0, 200) || "Upload",
          contentType,
          sizeBytes: file.bytes.length,
          storageKey: stored.key,
          visibility: "ORGANIZATION",
          uploadedById: form.row.createdById,
          folderId: form.row.folderId,
        },
        select: { id: true, name: true },
      });
      await confirmFits(db, target.organizationId, file.bytes.length, null);
      return row;
    });
  } catch (error) {
    await deleteBlobs([stored.key]).catch(() => undefined);
    if (error instanceof UploadRefusedError)
      throw new FormUploadError(
        "This club is out of storage, so files can't be sent right now.",
        413,
      );
    throw error;
  }
}
