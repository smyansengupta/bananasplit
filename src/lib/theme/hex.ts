/**
 * Strict hex: the ONLY thing that keeps a theme value from breaking out of
 * the server-rendered <style> (a `;`, `}`, `</style>`, `url(...)` or
 * `expression(...)` can never match). Applied on write (validate.ts, the
 * save action) and again at render (css.ts), so a row written by any other
 * path still cannot inject CSS. Kept free of zod so client code (the
 * preview, the editor) can use it without the schema library.
 */
export const HEX_RE = /^#[0-9a-f]{6}$/i;

export function isHex(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

/** Lowercases a valid hex; returns null for anything else (no trimming, no coercion). */
export function normalizeHex(value: unknown): string | null {
  return isHex(value) ? value.toLowerCase() : null;
}
