import { TZDate } from "@date-fns/tz";

import { cellKey, FIRST_HOUR, LAST_HOUR, weeklyCells, type Availability } from "@/lib/availability";
import { addDaysToKey, localDateKey, weekdayOfKey } from "@/lib/tasks/dates";

/**
 * Focus time on the Overview: the member's free hours over the next seven
 * days, and their longest free stretch. Free means inside the availability
 * grid's day (8 AM to 11 PM), not blocked in their availability (weekly
 * blocks and rules, and one-off date rules), not taken by an event they're
 * going to, and not already past. Whole hours only: a meeting from 2:30 to
 * 3:30 takes both the 2 and the 3 o'clock hour.
 *
 * Pure: the day keys, the current hour and the busy spans come in.
 */

/** Something on the calendar on the day `key`, in local hours (14.5 is 2:30 PM). */
export interface BusySpan {
  key: string;
  from: number;
  to: number;
}

export interface FocusDay {
  key: string;
  /** "S", "M", "T"... */
  letter: string;
  /** Free whole hours that day. */
  free: number;
}

export interface FocusBlock {
  key: string;
  /** Local hours, end exclusive: 14 to 18 is 2 to 6 PM. */
  start: number;
  end: number;
}

export interface FocusWeek {
  days: FocusDay[];
  /** The longest free stretch, the earliest of equals; null when there's no free hour. */
  best: FocusBlock | null;
}

const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
/** The grid's day ends after its last row (10 to 11 PM). */
const DAY_END = LAST_HOUR + 1;

/** The busy whole hours of the day `key`, by hour. */
function busyHours(
  key: string,
  weekly: ReadonlyMap<string, unknown>,
  availability: Availability,
  spans: readonly BusySpan[],
): Set<number> {
  const busy = new Set<number>();
  // The grid counts Monday as 0; date keys count Sunday as 0.
  const day = (weekdayOfKey(key) + 6) % 7;
  for (let h = FIRST_HOUR; h < DAY_END; h += 1) {
    if (weekly.has(cellKey(day, h))) busy.add(h);
  }
  for (const rule of availability.rules) {
    if (rule.kind !== "date" || rule.date !== key) continue;
    const from = rule.start ?? 0;
    const to = rule.end ?? 24;
    for (let h = from; h < to; h += 1) busy.add(h);
  }
  for (const span of spans) {
    if (span.key !== key) continue;
    for (let h = Math.floor(span.from); h < Math.ceil(span.to); h += 1) busy.add(h);
  }
  return busy;
}

export function focusWeek({
  todayKey,
  nowHour,
  availability,
  events,
  days = 7,
}: {
  todayKey: string;
  /** The local hour now (fractional): today's hours before the next whole one are past. */
  nowHour: number;
  availability: Availability;
  events: readonly BusySpan[];
  days?: number;
}): FocusWeek {
  const weekly = weeklyCells(availability);
  const out: FocusDay[] = [];
  let best: FocusBlock | null = null;
  for (let i = 0; i < days; i += 1) {
    const key = addDaysToKey(todayKey, i);
    const busy = busyHours(key, weekly, availability, events);
    const first = i === 0 ? Math.max(FIRST_HOUR, Math.ceil(nowHour)) : FIRST_HOUR;
    let free = 0;
    let runStart: number | null = null;
    for (let h = first; h <= DAY_END; h += 1) {
      const open = h < DAY_END && !busy.has(h);
      if (open) {
        free += 1;
        if (runStart === null) runStart = h;
        continue;
      }
      if (runStart !== null) {
        if (!best || h - runStart > best.end - best.start) best = { key, start: runStart, end: h };
        runStart = null;
      }
    }
    out.push({ key, letter: LETTERS[weekdayOfKey(key)]!, free });
  }
  return { days: out, best };
}

/** "2 PM", "12 PM", "11 PM". */
function hourWord(hour: number): string {
  const h = ((hour + 11) % 12) + 1;
  return `${h} ${hour < 12 || hour === 24 ? "AM" : "PM"}`;
}

/** "2 to 6 PM", "10 AM to 2 PM". */
export function blockHours(start: number, end: number): string {
  const s = hourWord(start);
  const e = hourWord(end);
  return s.slice(-2) === e.slice(-2) ? `${s.slice(0, -3)} to ${e}` : `${s} to ${e}`;
}

/** How many hours, in words: "1 hour", "4 hours". */
export function hoursWord(n: number): string {
  return `${n} ${n === 1 ? "hour" : "hours"}`;
}

/** Local hours of `at` in `tz`, with minutes as a fraction (14.5 is 2:30 PM). */
export function localHours(at: Date, tz: string): number {
  const z = new TZDate(at.getTime(), tz);
  return z.getHours() + z.getMinutes() / 60;
}

/** An event as busy spans, a day at a time (one past midnight runs on into the next day). */
export function spansOf(startsAt: Date, endsAt: Date, tz: string): BusySpan[] {
  const out: BusySpan[] = [];
  const endKey = localDateKey(endsAt, tz);
  let key = localDateKey(startsAt, tz);
  let from = localHours(startsAt, tz);
  for (let i = 0; i < 14 && key <= endKey; i += 1) {
    const to = key === endKey ? localHours(endsAt, tz) : 24;
    if (to > from) out.push({ key, from, to });
    key = addDaysToKey(key, 1);
    from = 0;
  }
  return out;
}
