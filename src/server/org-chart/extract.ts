import { inflateRawSync } from "node:zlib";

import mammoth from "mammoth";

import { cleanText } from "@/lib/org-chart/text";

/**
 * Reading an uploaded org-chart document (decision 'Org chart parsing with
 * Claude'). Every input is untrusted:
 *
 * - sniffSource() decides the type from the bytes, never from the client's
 *   Content-Type: PDF by its %PDF- header; DOCX as a ZIP holding
 *   [Content_Types].xml and word/document.xml (macro-enabled .docm, ODT and
 *   other ZIPs are refused); RTF refused; MD/TXT as valid UTF-8 with no NUL.
 * - DOCX goes through zip-bomb guards before mammoth sees it: at most 500
 *   entries, at most 20 MB uncompressed, a compression ratio of at most 100,
 *   no encryption or ZIP64, and every entry is actually inflated with a hard
 *   output cap, so a header that lies about its size is caught.
 * - PDF is not parsed here: it goes to Claude as a native document block,
 *   at most 20 pages, no encryption.
 * - Text is NFC-normalized with control characters stripped, at most 200k
 *   characters (refused above, never silently truncated).
 */

export const MAX_ZIP_ENTRIES = 500;
export const MAX_ZIP_UNCOMPRESSED = 20 * 1024 * 1024;
export const MAX_ZIP_RATIO = 100;
export const MAX_PDF_PAGES = 20;
export const MAX_TEXT_CHARS = 200_000;

export type SourceKind = "pdf" | "docx" | "markdown" | "text";

export interface SniffedSource {
  kind: SourceKind;
  mimeType: string;
  extension: "pdf" | "docx" | "md" | "txt";
}

export type ExtractedSource =
  | { type: "pdf"; base64: string; pages: number | null }
  | { type: "text"; text: string; format: "markdown" | "text" | "docx" };

/** The file cannot be used; `message` is safe to show the uploader. */
export class SourceRejectedError extends Error {
  readonly status: number;
  constructor(message: string, status = 415) {
    super(message);
    this.name = "SourceRejectedError";
    this.status = status;
  }
}

const PDF: SniffedSource = { kind: "pdf", mimeType: "application/pdf", extension: "pdf" };
const DOCX: SniffedSource = {
  kind: "docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  extension: "docx",
};
const MARKDOWN: SniffedSource = { kind: "markdown", mimeType: "text/markdown", extension: "md" };
const TEXT: SniffedSource = { kind: "text", mimeType: "text/plain", extension: "txt" };

const SUPPORTED =
  "Upload a PDF, a Word document (.docx), a Google Doc downloaded as .docx or PDF, or a Markdown or text file.";

function startsWith(bytes: Buffer, text: string): boolean {
  return bytes.subarray(0, text.length).toString("latin1") === text;
}

function hasPrefix(bytes: Buffer, prefix: readonly number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b);
}

// ---------------------------------------------------------------- ZIP

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** Reads the central directory, enforcing the entry, size, ratio and feature limits. */
export function readZipDirectory(bytes: Buffer): ZipEntry[] {
  const bad = (why: string) =>
    new SourceRejectedError(`This Word document can't be read (${why}).`, 422);
  // End of central directory: the last 22+ bytes (a comment can follow, up to 64 KiB).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad("damaged archive");
  const count = bytes.readUInt16LE(eocd + 10);
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw bad("ZIP64 archives are not supported");
  if (count > MAX_ZIP_ENTRIES) throw bad("too many parts");
  if (cdOffset + cdSize > bytes.length) throw bad("damaged archive");

  const entries: ZipEntry[] = [];
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || bytes.readUInt32LE(p) !== 0x02014b50) throw bad("damaged archive");
    const flags = bytes.readUInt16LE(p + 8);
    const method = bytes.readUInt16LE(p + 10);
    const compressedSize = bytes.readUInt32LE(p + 20);
    const uncompressedSize = bytes.readUInt32LE(p + 24);
    const nameLength = bytes.readUInt16LE(p + 28);
    const extraLength = bytes.readUInt16LE(p + 30);
    const commentLength = bytes.readUInt16LE(p + 32);
    const localHeaderOffset = bytes.readUInt32LE(p + 42);
    const name = bytes.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    p += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw bad("it is password-protected");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff)
      throw bad("ZIP64 archives are not supported");
    if (method !== 0 && method !== 8) throw bad("unsupported compression");
    if (uncompressedSize > MAX_ZIP_UNCOMPRESSED) throw bad("a part is too large");
    if (uncompressedSize > 1024 && uncompressedSize > compressedSize * MAX_ZIP_RATIO)
      throw bad("suspicious compression");
    total += uncompressedSize;
    if (total > MAX_ZIP_UNCOMPRESSED) throw bad("it expands to more than 20 MB");
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localHeaderOffset });
  }
  return entries;
}

/**
 * Inflates every entry with a hard cap at its declared size, so a header
 * that under-reports (a zip bomb) fails here instead of inside mammoth.
 * Returns the actual total size.
 */
export function verifyZipEntries(bytes: Buffer, entries: readonly ZipEntry[]): number {
  const bad = (why: string) =>
    new SourceRejectedError(`This Word document can't be read (${why}).`, 422);
  let total = 0;
  for (const entry of entries) {
    const at = entry.localHeaderOffset;
    if (at + 30 > bytes.length || bytes.readUInt32LE(at) !== 0x04034b50)
      throw bad("damaged archive");
    const start = at + 30 + bytes.readUInt16LE(at + 26) + bytes.readUInt16LE(at + 28);
    const end = start + entry.compressedSize;
    if (end > bytes.length) throw bad("damaged archive");
    const data = bytes.subarray(start, end);
    let size: number;
    if (entry.method === 0) {
      size = data.length;
    } else {
      try {
        size = inflateRawSync(data, {
          maxOutputLength: Math.max(1, entry.uncompressedSize),
        }).length;
      } catch {
        throw bad("a part expands beyond its declared size");
      }
    }
    if (size !== entry.uncompressedSize) throw bad("a part does not match its declared size");
    total += size;
    if (total > MAX_ZIP_UNCOMPRESSED) throw bad("it expands to more than 20 MB");
  }
  return total;
}

function readZipText(bytes: Buffer, entry: ZipEntry): string {
  const start =
    entry.localHeaderOffset +
    30 +
    bytes.readUInt16LE(entry.localHeaderOffset + 26) +
    bytes.readUInt16LE(entry.localHeaderOffset + 28);
  const data = bytes.subarray(start, start + entry.compressedSize);
  const raw =
    entry.method === 0
      ? data
      : inflateRawSync(data, { maxOutputLength: entry.uncompressedSize || 1 });
  return raw.toString("utf8");
}

function sniffZip(bytes: Buffer): SniffedSource {
  const entries = readZipDirectory(bytes);
  // Inflate-check everything first, so reading the two small parts below is safe.
  verifyZipEntries(bytes, entries);
  const names = new Set(entries.map((e) => e.name));
  const mimetype = entries.find((e) => e.name === "mimetype");
  if (mimetype && /opendocument/.test(readZipText(bytes, mimetype))) {
    throw new SourceRejectedError(`OpenDocument files (.odt) aren't supported. ${SUPPORTED}`);
  }
  const contentTypes = entries.find((e) => e.name === "[Content_Types].xml");
  if (!contentTypes || !names.has("word/document.xml")) {
    throw new SourceRejectedError(`That ZIP file isn't a Word document. ${SUPPORTED}`);
  }
  const types = readZipText(bytes, contentTypes);
  if (/macroEnabled/i.test(types) || [...names].some((n) => /vbaProject\.bin$/i.test(n))) {
    throw new SourceRejectedError(
      "Macro-enabled Word documents (.docm) aren't accepted. Save it as .docx first.",
    );
  }
  return DOCX;
}

// ---------------------------------------------------------------- sniffing

function decodeUtf8(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

/** The document's type, from its bytes; `filename` only picks Markdown vs text. */
export function sniffSource(bytes: Buffer, filename: string): SniffedSource {
  if (bytes.length === 0) throw new SourceRejectedError("The file is empty.", 400);
  if (startsWith(bytes, "%PDF-")) return PDF;
  if (hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04])) return sniffZip(bytes);
  if (startsWith(bytes, "{\\rtf")) {
    throw new SourceRejectedError(`RTF files aren't supported. ${SUPPORTED}`);
  }
  if (hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0])) {
    throw new SourceRejectedError(
      `Old Word documents (.doc) aren't supported. Save it as .docx or PDF.`,
    );
  }
  if (decodeUtf8(bytes) === null)
    throw new SourceRejectedError(`That file type isn't supported. ${SUPPORTED}`);
  return /\.(md|markdown|mdown)$/i.test(filename) ? MARKDOWN : TEXT;
}

// ---------------------------------------------------------------- PDF

/**
 * One left-to-right pass over the file: `/Type /Page`, `/Type /Pages`,
 * `/Count n`, and `>`, which ends a dictionary.
 *
 * Every quantifier is bounded, so the scan is linear in the buffer. The
 * earlier form paired the two markers with `[^>]*?`, which re-scanned to the
 * end of the file for every `/Count n` that never found a `/Type /Pages`:
 * quadratic, and ~4x per doubling of the input (measured: 1 MB of
 * `"/Count 1 "` took 22.5 s, so minutes at the 4 MB upload cap). It runs
 * synchronously on the upload request and in the shared job drain, where no
 * abort signal can interrupt a regex, so one crafted file stalled the queue
 * for every org.
 */
const PDF_TOKEN = /\/Type\s{0,16}\/(Pages|Page)(?![A-Za-z])|\/Count\s{1,16}(\d{1,9})|>/g;

/** Bytes of a PDF scanned for the page tree. Uploads are capped at 4 MB. */
export const MAX_PDF_SCAN_BYTES = 8 * 1024 * 1024;

/**
 * Page count from the page tree (the largest /Count of a /Pages node, or the
 * number of /Page objects), or null when the tree is in compressed object
 * streams. Claude's own limits and the token preflight still apply.
 *
 * A /Count belongs to a /Pages node when the two sit in the same dictionary,
 * in either order — that is, with no `>` between them.
 */
export function countPdfPages(bytes: Buffer): number | null {
  const text = bytes.subarray(0, MAX_PDF_SCAN_BYTES).toString("latin1");
  let pages = 0;
  let counted = 0;
  // Per dictionary: the largest /Count seen, and whether /Type /Pages appeared.
  let sawPages = false;
  let dictCount = 0;
  for (const m of text.matchAll(PDF_TOKEN)) {
    if (m[1] === "Page") pages++;
    else if (m[1] === "Pages") sawPages = true;
    else if (m[2] !== undefined) dictCount = Math.max(dictCount, Number(m[2]));
    else {
      if (sawPages) counted = Math.max(counted, dictCount);
      sawPages = false;
      dictCount = 0;
    }
  }
  if (sawPages) counted = Math.max(counted, dictCount);
  const best = Math.max(pages, counted);
  return best > 0 ? best : null;
}

function checkPdf(bytes: Buffer): number | null {
  const tail = bytes.subarray(Math.max(0, bytes.length - 4096)).toString("latin1");
  const head = bytes.subarray(0, Math.min(bytes.length, 64 * 1024)).toString("latin1");
  if (/\/Encrypt\b/.test(tail) || /\/Encrypt\s+\d+\s+\d+\s+R/.test(head)) {
    throw new SourceRejectedError(
      "Password-protected PDFs can't be read. Remove the password and upload it again.",
      422,
    );
  }
  const pages = countPdfPages(bytes);
  if (pages !== null && pages > MAX_PDF_PAGES) {
    throw new SourceRejectedError(
      `PDFs are limited to ${MAX_PDF_PAGES} pages (this one has ${pages}).`,
      422,
    );
  }
  return pages;
}

// ---------------------------------------------------------------- text

export function normalizeDocumentText(text: string): string {
  return cleanText(text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function checkText(text: string): string {
  const clean = normalizeDocumentText(text);
  if (!clean) throw new SourceRejectedError("The document has no text to read.", 422);
  if (clean.length > MAX_TEXT_CHARS) {
    throw new SourceRejectedError(
      `The document is too long (${clean.length.toLocaleString("en-US")} characters; the limit is ${MAX_TEXT_CHARS.toLocaleString("en-US")}). Remove unrelated sections and upload it again.`,
      422,
    );
  }
  return clean;
}

/**
 * Cheap checks at upload time, so a bad file is refused before it is stored
 * (the job repeats everything in extractSource).
 */
export function preflightSource(bytes: Buffer, sniffed: SniffedSource): void {
  if (sniffed.kind === "pdf") checkPdf(bytes);
  else if (sniffed.kind === "docx") verifyZipEntries(bytes, readZipDirectory(bytes));
  else checkText(decodeUtf8(bytes) ?? "");
}

/** The document in the form Claude receives it. */
export async function extractSource(
  bytes: Buffer,
  sniffed: SniffedSource,
): Promise<ExtractedSource> {
  switch (sniffed.kind) {
    case "pdf": {
      const pages = checkPdf(bytes);
      return { type: "pdf", base64: bytes.toString("base64"), pages };
    }
    case "docx": {
      verifyZipEntries(bytes, readZipDirectory(bytes));
      let value: string;
      try {
        ({ value } = await mammoth.extractRawText({ buffer: bytes }));
      } catch {
        throw new SourceRejectedError(
          "This Word document can't be read. Try saving it again or exporting a PDF.",
          422,
        );
      }
      return { type: "text", text: checkText(value), format: "docx" };
    }
    case "markdown":
    case "text": {
      const text = decodeUtf8(bytes);
      if (text === null) throw new SourceRejectedError("The file is not valid UTF-8 text.", 422);
      return { type: "text", text: checkText(text), format: sniffed.kind };
    }
  }
}
