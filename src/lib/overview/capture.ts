import { parseDueText } from "@/lib/tasks/due-text";

/**
 * Quick capture on the Overview: one typed line, read as the task it will
 * become. "Order pizza for Fall Social by Wed" is the task "Order pizza for
 * Fall Social", due this Wednesday, linked to the Fall Social event.
 *
 * - A date can sit anywhere in the line: today, tonight, tomorrow, next
 *   week, a weekday ("fri", "next thu"), "in 3 days", "Nov 12", "12 Nov",
 *   "11/12", optionally after "by", "on", "due" or "before". It comes out
 *   of the title. The dates themselves are read by the task form's own
 *   parser (src/lib/tasks/due-text.ts).
 * - Words that are also names or common words ("Tom", "now", "sat",
 *   "sun", "may") only count as a date after one of those lead words.
 * - An upcoming event whose title appears in the line is the event it's
 *   for: the longest title wins, then the soonest. The title stays as typed.
 *
 * Pure: no React, no clock (today comes in).
 */

export interface CaptureEvent {
  id: string;
  title: string;
  /** The event's day, "YYYY-MM-DD". */
  dateKey: string;
}

export interface Capture {
  /** What the task or note is called: the line without its date. */
  title: string;
  dueKey: string | null;
  /** The words read as the date, as typed ("by Wed"). */
  dueText: string | null;
  event: CaptureEvent | null;
}

const LEADS = new Set(["by", "on", "due", "before"]);
const MONTHS = [
  "jan",
  "january",
  "feb",
  "february",
  "mar",
  "march",
  "apr",
  "april",
  "may",
  "jun",
  "june",
  "jul",
  "july",
  "aug",
  "august",
  "sep",
  "sept",
  "september",
  "oct",
  "october",
  "nov",
  "november",
  "dec",
  "december",
];
/** Weekdays safe on their own: they're rarely anything else. */
const WEEKDAYS = [
  "mon",
  "monday",
  "tue",
  "tues",
  "tuesday",
  "wed",
  "weds",
  "wednesday",
  "thu",
  "thur",
  "thurs",
  "thursday",
  "fri",
  "friday",
  "saturday",
  "sunday",
];
/** Weekdays that are also ordinary words: a date only after a lead word. */
const LEAD_ONLY_WEEKDAYS = ["sat", "sun"];

/** A word as the date parser wants it: lower-case, no trailing punctuation. */
function bare(word: string): string {
  return word.toLowerCase().replace(/^[("']+|[)"'.,;:!?]+$/g, "");
}

/**
 * What the words starting at `i` say as a date, and how many words that
 * takes; `led` when a lead word ("by") came just before.
 */
function dateAt(
  words: readonly string[],
  i: number,
  todayKey: string,
  led: boolean,
): { key: string; length: number } | null {
  const w = (k: number) => (i + k < words.length ? bare(words[i + k]!) : "");
  const a = w(0);
  const b = w(1);
  const c = w(2);
  const read = (text: string, length: number) => {
    const key = parseDueText(text, todayKey);
    return key ? { key, length } : null;
  };

  if (a === "today" || a === "tonight") return { key: todayKey, length: 1 };
  if (a === "tomorrow" || a === "tmrw") return read("tomorrow", 1);
  if (a === "next" && b === "week") return read("next week", 2);
  if (a === "next" || a === "this") {
    if (WEEKDAYS.includes(b) || LEAD_ONLY_WEEKDAYS.includes(b)) return read(`${a} ${b}`, 2);
    return null;
  }
  if (a === "in" && /^\d{1,3}$/.test(b) && /^(days?|weeks?)$/.test(c)) {
    return read(`in ${b} ${c}`, 3);
  }
  if (WEEKDAYS.includes(a) || (led && LEAD_ONLY_WEEKDAYS.includes(a))) return read(a, 1);
  // "Nov 12", "November 12th"
  if (MONTHS.includes(a) && /^\d{1,2}(st|nd|rd|th)?$/.test(b)) {
    if (a === "may" && !led) return null;
    return read(`${a} ${b.replace(/\D/g, "")}`, 2);
  }
  // "12 Nov", "12th of November"
  if (/^\d{1,2}(st|nd|rd|th)?$/.test(a)) {
    const month = b === "of" ? c : b;
    if (MONTHS.includes(month)) return read(`${a.replace(/\D/g, "")} ${month}`, b === "of" ? 3 : 2);
  }
  // "11/12"
  if (/^\d{1,2}\/\d{1,2}$/.test(a)) return read(a, 1);
  return null;
}

/** The first date in the line, with its lead word, as word positions. */
function findDate(
  words: readonly string[],
  todayKey: string,
): { key: string; from: number; to: number } | null {
  for (let i = 0; i < words.length; i += 1) {
    const led = i > 0 && LEADS.has(bare(words[i - 1]!));
    const hit = dateAt(words, i, todayKey, led);
    if (!hit) continue;
    return { key: hit.key, from: led ? i - 1 : i, to: i + hit.length };
  }
  return null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The upcoming event the line names: the longest title it contains, then the soonest. */
export function matchEvent(text: string, events: readonly CaptureEvent[]): CaptureEvent | null {
  const hay = text.toLowerCase();
  let best: CaptureEvent | null = null;
  for (const event of events) {
    const name = event.title.trim().toLowerCase();
    if (name.length < 3) continue;
    const at = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "u");
    if (!at.test(hay)) continue;
    if (
      !best ||
      name.length > best.title.trim().length ||
      (name.length === best.title.trim().length && event.dateKey < best.dateKey)
    ) {
      best = event;
    }
  }
  return best;
}

export function parseCapture(
  text: string,
  todayKey: string,
  events: readonly CaptureEvent[],
): Capture {
  const line = text.replace(/\s+/g, " ").trim();
  const words = line ? line.split(" ") : [];
  const date = findDate(words, todayKey);
  let title = line;
  let dueText: string | null = null;
  if (date) {
    const before = words.slice(0, date.from);
    // "for Fall Social by Wed, about $180": the comma stays with what's left.
    const lastWord = words[date.to - 1]!;
    if (before.length > 0 && date.to < words.length && /,$/.test(lastWord)) {
      before[before.length - 1] = `${before[before.length - 1]!.replace(/,$/, "")},`;
    }
    const kept = [...before, ...words.slice(date.to)].join(" ");
    // Only when something is left to call it.
    if (kept.replace(/[\s,.;:!?-]+/g, "").length > 0) {
      dueText = words
        .slice(date.from, date.to)
        .join(" ")
        .replace(/[,.;:!?]+$/, "");
      title = kept
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/,(\s*,)+/g, ",")
        .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
        .trim();
    }
  }
  return {
    title,
    dueKey: dueText ? date!.key : null,
    dueText,
    event: matchEvent(line, events),
  };
}
