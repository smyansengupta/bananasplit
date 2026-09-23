/**
 * Text cleaning shared by extraction, normalization and the draft editor.
 * Pure and client-safe.
 */

// C0 and C1 control characters except tab (\u0009), newline (\u000A) and
// carriage return (\u000D), plus the Unicode bidi overrides and zero-width
// characters that can hide text in a rendered chart.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

/** NFC, control characters stripped, CRLF normalized. Keeps line breaks. */
export function cleanText(input: string): string {
  return input.normalize("NFC").replace(/\r\n?/g, "\n").replace(CONTROL, "");
}

/** One line: cleaned, whitespace collapsed, trimmed. */
export function cleanLine(input: string | null | undefined): string {
  if (!input) return "";
  return cleanText(input).replace(/\s+/g, " ").trim();
}

/** Clamps to `max` characters, ending with an ellipsis when cut. */
export function clamp(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

const BULLET_PREFIX = /^(?:[-*•·◦▪–—]+|\d+[.)])\s+/;

/**
 * A bullet list: each item cleaned, stripped of a leading bullet marker,
 * clamped, empty items dropped and duplicates (case- and space-insensitive)
 * removed, at most `maxItems` kept.
 */
export function cleanBullets(items: readonly string[], maxItems: number, maxLength: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const line = clamp(cleanLine(item).replace(BULLET_PREFIX, "").trim(), maxLength);
    if (!line) continue;
    const fold = line.toLowerCase();
    if (seen.has(fold)) continue;
    seen.add(fold);
    out.push(line);
    if (out.length >= maxItems) break;
  }
  return out;
}

/** Lowercase ASCII-ish fold for comparisons: NFKD, diacritics removed. */
export function foldCase(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * A position key from a title: "VP Ops & Programs" -> "vp-ops-programs".
 * At most 60 characters; "position" when nothing is left.
 */
export function positionKeyFromTitle(title: string): string {
  const slug = foldCase(title)
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "position";
}

/** `base`, or `base-2`, `base-3`... whichever is not in `taken`. Adds it to `taken`. */
export function uniqueKey(base: string, taken: Set<string>): string {
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, 56)}-${n}`;
  taken.add(key);
  return key;
}
