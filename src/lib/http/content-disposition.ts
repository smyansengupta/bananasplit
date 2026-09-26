/**
 * A Content-Disposition header value for a user-supplied file name
 * (0A Fix 12). The receipt download used to interpolate Receipt.filename
 * straight into `filename="..."`, so a name containing a quote, a backslash
 * or CR/LF could break out of the parameter or inject a header.
 *
 * Per RFC 6266 / RFC 5987 the value carries two parameters:
 * - `filename="..."`: an ASCII-only fallback with every quote, backslash,
 *   control character and non-ASCII character replaced by "_";
 * - `filename*=UTF-8''...`: the real name, percent-encoded, which every
 *   current browser prefers.
 */

const MAX_NAME_LENGTH = 180;

function asciiFallback(name: string): string {
  const cleaned = name.replace(/[^\x20-\x7e]|["\\]/g, "_").trim();
  return cleaned || "download";
}

/** RFC 5987 attr-char encoding: encodeURIComponent plus the characters it leaves alone. */
function rfc5987Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function contentDisposition(
  type: "inline" | "attachment",
  filename: string | null | undefined,
): string {
  // Strip control characters (CR/LF included) before anything else, and keep
  // the header a sane length.
  const name = (filename ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, MAX_NAME_LENGTH);
  const safeName = name.trim() || "download";
  return `${type}; filename="${asciiFallback(safeName)}"; filename*=UTF-8''${rfc5987Encode(safeName)}`;
}
