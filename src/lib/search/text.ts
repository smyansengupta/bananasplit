/**
 * Text matching for workspace search (the ⌘K palette): turning what was
 * typed into terms, scoring a record against them, and picking the part of
 * a long text worth showing. Pure and client-safe; the server ranks with the
 * same functions the palette highlights with, so what scores is what lights up.
 *
 * Matching is per word, in any order: "budget spring" finds "Spring budget
 * review". Case and accents are ignored when scoring ("cafe" scores "Café").
 */

export const MAX_QUERY_LENGTH = 200;
const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 40;

// Combining marks belong to the word they sit on (a decomposed "é", a Devanagari vowel sign).
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu;
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
const MARKS = /\p{M}+/gu;

export interface ParsedQuery {
  /** What was typed, trimmed, whitespace collapsed, capped. */
  text: string;
  /**
   * The words, lowercased, for the database (ILIKE and the full-text
   * prefix query). Letters, digits and combining marks only, so they never
   * carry LIKE wildcards or tsquery operators.
   */
  terms: string[];
  /** The same words folded (accents removed), for scoring and highlighting. */
  folded: string[];
  /** The whole query folded, for phrase bonuses. */
  phrase: string;
}

/**
 * Lowercases and strips accents one character at a time, so the result is
 * exactly as long as the input and an index into one is an index into the
 * other (highlighting relies on that).
 */
export function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const stripped = ch.normalize("NFD").replace(MARKS, "").toLowerCase();
    if (stripped.length === ch.length) {
      out += stripped;
      continue;
    }
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

export function parseQuery(raw: string): ParsedQuery {
  // NFC first, so typed or pasted decomposed accents ("e" + U+0301) match stored "é".
  const text = raw.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  const terms: string[] = [];
  for (const match of text.toLowerCase().matchAll(WORD)) {
    const term = match[0].slice(0, MAX_TERM_LENGTH);
    if (!terms.includes(term)) terms.push(term);
    if (terms.length === MAX_TERMS) break;
  }
  const folded = [...new Set(terms.map(fold))];
  return { text, terms, folded, phrase: fold(terms.join(" ")) };
}

/**
 * A Postgres to_tsquery() string that matches every term as a word prefix
 * ("quart:* & budg:*"), so a note is found while its words are still being
 * typed; with `any`, one that matches any of them ("quart:* | budg:*"), for
 * picking the passage to show. Null when there is nothing to match.
 */
export function prefixTsQuery(terms: readonly string[], { any = false } = {}): string | null {
  return terms.length ? terms.map((t) => `${t}:*`).join(any ? " | " : " & ") : null;
}

/** The LIKE patterns for `terms`: each one anywhere in the text. */
export function containsPatterns(terms: readonly string[]): string[] {
  return terms.map((t) => `%${t}%`);
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * How well `term` occurs in `text` (both folded): 3 for a whole word, 2 for
 * the start of a word, 1 anywhere else, 0 not at all.
 */
function matchQuality(text: string, term: string): number {
  let best = 0;
  let from = 0;
  while (from <= text.length - term.length) {
    const at = text.indexOf(term, from);
    if (at === -1) break;
    const startsWord = !isWordChar(text[at - 1]);
    const endsWord = !isWordChar(text[at + term.length]);
    const quality = startsWord ? (endsWord ? 3 : 2) : 1;
    if (quality > best) best = quality;
    if (best === 3) break;
    from = at + 1;
  }
  return best;
}

export interface ScoredField {
  text: string | null | undefined;
  /** How much a match here counts; the first field is the record's name. */
  weight: number;
}

/**
 * A relevance score for one record. Each term counts its best match across
 * the fields (whole word > word start > inside a word, times the field's
 * weight); the name field earns more when it IS the query, starts with it
 * or contains the whole phrase. With `requireAll`, a record missing any term
 * scores 0; otherwise the score shrinks with the share of terms found (a
 * full-text stem match the substring test can't see still ranks, just lower).
 */
export function scoreFields(
  fields: readonly ScoredField[],
  query: Pick<ParsedQuery, "folded" | "phrase">,
  { requireAll = false }: { requireAll?: boolean } = {},
): number {
  const { folded: terms, phrase } = query;
  if (!terms.length) return 0;
  const texts = fields.map((f) => ({ text: f.text ? fold(f.text) : "", weight: f.weight }));

  let total = 0;
  let found = 0;
  for (const term of terms) {
    let best = 0;
    for (const f of texts) {
      if (!f.text) continue;
      best = Math.max(best, matchQuality(f.text, term) * f.weight);
    }
    if (best > 0) found++;
    total += best;
  }
  if (found === 0 || (requireAll && found < terms.length)) return 0;

  const name = texts[0];
  if (name?.text && phrase) {
    const trimmed = name.text.trim();
    if (trimmed === phrase) total += 10 * name.weight;
    else if (trimmed.startsWith(phrase)) {
      // "Budget review" for "budget" leads; "Budgeting 101" only edges out
      // an equal match (it is still the first thing in the name).
      total += (isWordChar(trimmed[phrase.length]) ? 0.5 : 6) * name.weight;
    } else if (terms.length > 1 && trimmed.includes(phrase)) total += 3 * name.weight;
  }
  return total * (found / terms.length);
}

/**
 * Where `terms` occur in `text`, as merged [start, end) ranges, for
 * highlighting. Short terms (one or two letters) only light up at the
 * start of a word; longer ones anywhere.
 */
export function highlightRanges(text: string, terms: readonly string[]): [number, number][] {
  if (!text || !terms.length) return [];
  const folded = fold(text);
  const ranges: [number, number][] = [];
  for (const term of terms) {
    if (!term) continue;
    let from = 0;
    while (from <= folded.length - term.length) {
      const at = folded.indexOf(term, from);
      if (at === -1) break;
      if (term.length > 2 || !isWordChar(folded[at - 1])) ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/**
 * A short excerpt of `text` around the first place a term occurs, cut at
 * word boundaries, with "…" where it was cut. Null when no term occurs
 * (the caller decides whether a plain opening line is worth showing).
 */
export function excerptAround(
  text: string | null | undefined,
  terms: readonly string[],
  maxLength = 140,
): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  const folded = fold(flat);
  let first = -1;
  for (const term of terms) {
    const at = term ? folded.indexOf(term) : -1;
    if (at !== -1 && (first === -1 || at < first)) first = at;
  }
  if (first === -1) return null;
  if (flat.length <= maxLength) return flat;

  // Some context before the match, the rest after it.
  let start = Math.max(0, first - Math.floor(maxLength / 3));
  let end = Math.min(flat.length, start + maxLength);
  start = Math.max(0, end - maxLength);
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    if (space !== -1 && space < first) start = space + 1;
  }
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > first) end = space;
  }
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** The opening of `text` on one line, for a record matched by its name. */
export function openingLine(text: string | null | undefined, maxLength = 120): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (flat.length <= maxLength) return flat;
  const space = flat.lastIndexOf(" ", maxLength);
  return `${flat.slice(0, space > maxLength / 2 ? space : maxLength)}…`;
}
