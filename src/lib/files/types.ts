import { sniffMimeType } from "@/lib/finance/file-sniff";

/**
 * What the Notes page accepts, decided from the bytes (never the client's
 * declared type): PDFs and images by magic bytes; Word, PowerPoint and Excel
 * as ZIP containers whose parts say which one; plain text, Markdown and CSV
 * when the bytes are valid UTF-8 with no NUL, told apart by the extension.
 */

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type FileFamily = "pdf" | "image" | "word" | "slides" | "sheet" | "text";

export function familyOf(contentType: string): FileFamily {
  if (contentType === "application/pdf") return "pdf";
  if (contentType.startsWith("image/")) return "image";
  if (contentType === DOCX) return "word";
  if (contentType === PPTX) return "slides";
  if (contentType === XLSX) return "sheet";
  return "text";
}

function extension(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** A ZIP (the Office formats) whose central directory names one of the Office parts. */
function officeType(bytes: Buffer): string | null {
  if (!isZip(bytes)) return null;
  // Part names are stored uncompressed in the local headers and the
  // central directory, so a plain byte search finds them.
  const text = bytes.toString("latin1");
  if (text.includes("word/document.xml")) return DOCX;
  if (text.includes("ppt/presentation.xml")) return PPTX;
  if (text.includes("xl/workbook.xml")) return XLSX;
  return null;
}

const TEXT_EXTENSIONS = new Set(["", "txt", "text", "md", "markdown", "csv"]);

function isUtf8Text(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** The accepted type of an upload, or null to refuse it. */
export function sniffNoteFile(bytes: Buffer, filename: string): string | null {
  const magic = sniffMimeType(bytes);
  if (magic) return magic;
  const office = officeType(bytes);
  if (office) return office;
  // Any other archive is refused, even when its first bytes happen to be text.
  if (isZip(bytes)) return null;
  // Text only by its own names: an .html or .svg file is text too, and is
  // refused rather than kept as something it is not.
  const ext = extension(filename);
  if (bytes.length > 0 && TEXT_EXTENSIONS.has(ext) && isUtf8Text(bytes)) {
    if (ext === "md" || ext === "markdown") return "text/markdown";
    if (ext === "csv") return "text/csv";
    return "text/plain";
  }
  return null;
}

export const NOTE_FILE_ACCEPT = [
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".txt",
  ".md",
  ".csv",
].join(",");

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The Google Docs document id in a share link, or null for anything that is
 * not a docs.google.com document URL.
 */
export function googleDocId(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
  const m = /^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/.exec(url.pathname);
  return m ? m[1] : null;
}
