import mammoth from "mammoth";

import { DOCX, googleDocId, sniffNoteFile } from "@/lib/files/types";
import { trashCutoff } from "@/lib/notes/trash";
import { withOrgTx, type TxClient } from "@/server/db/context";
import { readZipDirectory, verifyZipEntries, SourceRejectedError } from "@/server/org-chart/extract";
import { deleteBlobs, getBlob, MAX_UPLOAD_BYTES, putBlob, randomKeyId } from "@/server/storage";

/**
 * Files on the Notes page (OrgFile): PDFs, Word, slides, images and text,
 * stored in the private Blob store and read back only through
 * /api/orgs/{orgId}/files/{fileId}, which re-reads the row as the caller so
 * RLS decides (shared with the org, or private to the uploader).
 *
 * Word documents and Google Docs can also become notes: the .docx is turned
 * into HTML here (behind the same zip-bomb guards as the org chart import),
 * and the browser turns that HTML into the note's editor document, so only
 * what the note schema allows survives.
 */

export class FileRejectedError extends Error {
  readonly status: number;
  constructor(message: string, status = 415) {
    super(message);
    this.name = "FileRejectedError";
    this.status = status;
  }
}

const UNSUPPORTED =
  "That file type isn't supported. Upload a PDF, Word, PowerPoint, Excel, image, text, Markdown or CSV file.";

export interface NoteFileRow {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  visibility: "PRIVATE" | "ORGANIZATION";
  createdAt: Date;
  noteId: string | null;
  folderId: string | null;
  excerpt: string | null;
  uploadedBy: { id: string; name: string | null };
}

const fileSelect = {
  id: true,
  name: true,
  contentType: true,
  sizeBytes: true,
  visibility: true,
  createdAt: true,
  noteId: true,
  folderId: true,
  excerpt: true,
  uploadedBy: { select: { id: true, name: true } },
} as const;

function cleanName(name: string): string {
  const one = name.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return (one.length > 200 ? one.slice(0, 200) : one) || "Untitled file";
}

/**
 * Stores an upload and records it, as the uploader. The blob is written
 * first (never inside a transaction); a failed row write deletes it.
 */
export async function storeNoteFile(input: {
  orgId: string;
  bytes: Buffer;
  filename: string;
  visibility: "PRIVATE" | "ORGANIZATION";
  noteId?: string | null;
  folderId?: string | null;
}): Promise<NoteFileRow> {
  const contentType = sniffNoteFile(input.bytes, input.filename);
  if (!contentType) throw new FileRejectedError(UNSUPPORTED);
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw new FileRejectedError("Files are limited to 4 MB.", 413);
  const excerpt = await excerptOf(input.bytes, contentType);
  const stored = await putBlob("files", input.orgId, [randomKeyId()], input.bytes, { contentType });
  try {
    return await withOrgTx(input.orgId, ({ db, userId }) =>
      db.orgFile.create({
        data: {
          organizationId: input.orgId,
          name: cleanName(input.filename),
          contentType,
          sizeBytes: input.bytes.length,
          storageKey: stored.key,
          visibility: input.visibility,
          uploadedById: userId,
          noteId: input.noteId ?? null,
          folderId: input.folderId ?? null,
          excerpt,
        },
        select: fileSelect,
      }),
    );
  } catch (error) {
    await deleteBlobs([stored.key]).catch(() => undefined);
    throw error;
  }
}

export function listNoteFiles(
  db: TxClient,
  orgId: string,
  filters: { folderId?: string; q?: string } = {},
): Promise<NoteFileRow[]> {
  const q = filters.q?.trim().slice(0, 100);
  return db.orgFile.findMany({
    where: {
      organizationId: orgId,
      deletedAt: null,
      ...(filters.folderId ? { folderId: filters.folderId === "none" ? null : filters.folderId } : {}),
      ...(q
        ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { excerpt: { contains: q, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    select: fileSelect,
    take: 200,
  });
}

export function getNoteFile(db: TxClient, orgId: string, fileId: string): Promise<NoteFileRow | null> {
  return db.orgFile.findFirst({
    where: { id: fileId, organizationId: orgId, deletedAt: null },
    select: fileSelect,
  });
}

/** The file's bytes for someone RLS lets see its row, else null. */
export async function readNoteFile(
  orgId: string,
  fileId: string,
): Promise<{ row: NoteFileRow; body: Buffer } | null> {
  const found = await withOrgTx(orgId, ({ db }) =>
    db.orgFile.findFirst({
      where: { id: fileId, organizationId: orgId, deletedAt: null },
      select: { ...fileSelect, storageKey: true },
    }),
  );
  if (!found) return null;
  const blob = await getBlob(found.storageKey);
  if (!blob) return null;
  const { storageKey: _key, ...row } = found;
  return { row, body: blob.body };
}

/**
 * Moves a file to "Recently deleted" (the uploader or an admin, as RLS
 * allows). Its bytes stay NOTE_TRASH_DAYS so it can be restored; the daily
 * maintenance job deletes them after that.
 */
export async function removeNoteFile(db: TxClient, orgId: string, fileId: string): Promise<string | null> {
  const row = await db.orgFile.findFirst({
    where: { id: fileId, organizationId: orgId, deletedAt: null },
    select: { storageKey: true },
  });
  if (!row) return null;
  const { count } = await db.orgFile.updateMany({
    where: { id: fileId, organizationId: orgId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return count > 0 ? row.storageKey : null;
}

/** Brings a file back from "Recently deleted" (within NOTE_TRASH_DAYS). */
export async function restoreNoteFile(db: TxClient, orgId: string, fileId: string): Promise<boolean> {
  const { count } = await db.orgFile.updateMany({
    where: { id: fileId, organizationId: orgId, deletedAt: { gte: trashCutoff() } },
    data: { deletedAt: null },
  });
  return count > 0;
}

export interface DeletedNoteFile {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  deletedAt: Date;
}

/** Files deleted in the last NOTE_TRASH_DAYS that this member may restore. */
export function listDeletedNoteFiles(
  db: TxClient,
  orgId: string,
  userId: string,
  isAdmin: boolean,
): Promise<DeletedNoteFile[]> {
  return db.orgFile.findMany({
    where: {
      organizationId: orgId,
      deletedAt: { gte: trashCutoff() },
      ...(isAdmin ? {} : { uploadedById: userId }),
    },
    orderBy: { deletedAt: "desc" },
    select: { id: true, name: true, contentType: true, sizeBytes: true, deletedAt: true },
    take: 100,
  }) as Promise<DeletedNoteFile[]>;
}

const EXCERPT_CHARS = 500;

/** The first few hundred characters of a Word, text or CSV file, for cards and search. */
async function excerptOf(bytes: Buffer, contentType: string): Promise<string | null> {
  try {
    let text: string | null = null;
    if (contentType === DOCX) {
      verifyZipEntries(bytes, readZipDirectory(bytes));
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
    } else if (contentType.startsWith("text/")) {
      text = bytes.subarray(0, 8_000).toString("utf8");
    }
    if (!text) return null;
    const clean = text
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return clean ? clean.slice(0, EXCERPT_CHARS) : null;
  } catch {
    // A preview is a nicety: an unreadable document still uploads.
    return null;
  }
}

// ---------------------------------------------------------------- Word to note

/** A .docx as HTML for the editor to read in (images are left out). */
export async function docxToHtml(bytes: Buffer): Promise<string> {
  if (sniffNoteFile(bytes, "document.docx") !== DOCX) {
    throw new FileRejectedError("That isn't a Word document (.docx).");
  }
  try {
    verifyZipEntries(bytes, readZipDirectory(bytes));
  } catch (error) {
    if (error instanceof SourceRejectedError) throw new FileRejectedError(error.message, 422);
    throw error;
  }
  try {
    const { value } = await mammoth.convertToHtml(
      { buffer: bytes },
      { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
    );
    return value;
  } catch {
    throw new FileRejectedError("This Word document can't be read. Try saving it again.", 422);
  }
}

/** A title for the note: the file name without its extension. */
export function titleFromFilename(name: string): string {
  return cleanName(name.replace(/\.[a-z0-9]{1,8}$/i, "")).slice(0, 200);
}

const GOOGLE_HOSTS = /^(docs\.google\.com|[a-z0-9-]+\.googleusercontent\.com)$/;

/**
 * Downloads a Google Doc as .docx through its export link. Works for docs
 * shared as "Anyone with the link"; anything else ends at Google's sign-in
 * page, which is reported as a sharing problem. Redirects are followed by
 * hand, only between Google's document hosts, with the size capped.
 */
export async function fetchGoogleDocAsDocx(link: string): Promise<{ bytes: Buffer; title: string | null }> {
  const id = googleDocId(link);
  if (!id) throw new FileRejectedError("Paste a Google Docs link (docs.google.com/document/…).", 400);
  let url = `https://docs.google.com/document/d/${id}/export?format=docx`;
  const notShared =
    "Google didn't let us open that doc. Share it as “Anyone with the link can view”, or download it as Word (.docx) and upload that.";
  for (let hop = 0; hop < 4; hop++) {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: DOCX },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new FileRejectedError(notShared, 422);
      const target = new URL(next, url);
      if (target.protocol !== "https:" || !GOOGLE_HOSTS.test(target.hostname)) {
        throw new FileRejectedError(notShared, 422);
      }
      url = target.toString();
      continue;
    }
    if (!res.ok) throw new FileRejectedError(notShared, 422);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_UPLOAD_BYTES) throw new FileRejectedError("That doc is over 4 MB.", 413);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_UPLOAD_BYTES) throw new FileRejectedError("That doc is over 4 MB.", 413);
    if (sniffNoteFile(bytes, "doc.docx") !== DOCX) throw new FileRejectedError(notShared, 422);
    const disposition = res.headers.get("content-disposition") ?? "";
    const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="([^"]+)"/i.exec(disposition);
    const title = m ? titleFromFilename(decodeURIComponent(m[1])) : null;
    return { bytes, title };
  }
  throw new FileRejectedError(notShared, 422);
}

