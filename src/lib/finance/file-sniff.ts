/**
 * Detects the real file type from its magic bytes rather than trusting the
 * client-supplied extension or MIME type (spec 5.5). This is the buildable
 * slice of "virus/type sniffing" without a third-party AV service wired up —
 * it stops someone renaming a script to "receipt.jpg", not payloads hidden
 * inside an otherwise-valid image/PDF container.
 */
export function sniffMimeType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes.subarray(0, 3).toString("ascii") === "GIF") {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

export const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
]);

/**
 * 4 MB (0A Fix 15): receipts upload through a route handler, and Vercel caps
 * a request body at about 4.5 MB. The client downscales larger photos first
 * (src/lib/finance/prepare-receipt.ts).
 */
export const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;

/** File extension for each accepted type, used in the storage key. */
export const RECEIPT_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
