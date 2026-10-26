import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * Text and time as the tools return them: long text in slices the AI app
 * can page through, and instants as ISO 8601 in the member's own zone.
 */

/** The most characters of one text a tool returns at once (get_note, fetch). */
export const TEXT_LIMIT = 40_000;

/** How far back from the limit a slice may end early, at a line break. */
const LINE_SLACK = 2_000;

export interface TextSlice {
  text: string;
  /** Where `text` starts in the whole. */
  offset: number;
  /** The whole text's length. */
  totalLength: number;
  /** More follows `text`. */
  truncated: boolean;
  /** The offset to ask for next, or null at the end. */
  nextOffset: number | null;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * At most `max` characters of `full` from `offset`. A cut slice ends after
 * a line break near the limit when there is one, and never between the two
 * halves of an emoji or other astral character.
 */
export function sliceText(full: string, offset = 0, max = TEXT_LIMIT): TextSlice {
  const totalLength = full.length;
  let start = Math.min(Math.max(0, Math.trunc(offset)), totalLength);
  if (start > 0 && start < totalLength && isLowSurrogate(full.charCodeAt(start))) start += 1;
  if (totalLength - start <= max) {
    return {
      text: full.slice(start),
      offset: start,
      totalLength,
      truncated: false,
      nextOffset: null,
    };
  }
  let end = start + max;
  const lineBreak = full.lastIndexOf("\n", end - 1);
  if (lineBreak >= end - LINE_SLACK && lineBreak > start) end = lineBreak + 1;
  else if (isHighSurrogate(full.charCodeAt(end - 1))) end -= 1;
  return {
    text: full.slice(start, end),
    offset: start,
    totalLength,
    truncated: true,
    nextOffset: end,
  };
}

/** An instant in `timeZone`, with its offset: "2026-10-27T18:00:00-04:00". */
export function zonedIso(date: Date, timeZone: string): string {
  return format(new TZDate(date.getTime(), timeZone), "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** A date-only value (due dates, the day of an expense) as yyyy-mm-dd. */
export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}
