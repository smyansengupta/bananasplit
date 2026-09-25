/**
 * Calendar date helpers in an org's timezone. Client-safe (no server imports).
 *
 * All-day events are stored as instants: startsAt is local midnight of the
 * first day in the org timezone and endsAt is local midnight AFTER the last
 * day (exclusive), the same convention as iCalendar DTEND and Google's
 * end.date. Older rows may carry an inclusive end (23:59:59 on the last
 * day); allDaySpan() reads both the same way, so every consumer (the ICS
 * feed, the Google mirror, the public JSON feed and the calendar grid) agrees
 * on which days an all-day event covers.
 */

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True for an IANA zone this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** A zone that is safe to use: the given one, or UTC when it is unknown. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === 24 ? 0 : parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "YYYY-MM-DD": the calendar date of `date` in `timeZone`. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Parses "YYYY-MM-DD", or returns null. */
export function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = DATE_KEY.exec(key);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Calendar arithmetic on a date key (no timezone involved). */
export function addDaysToKey(key: string, days: number): string {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`not a date key: ${key}`);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  const p = zonedParts(new Date(instant), timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant of a wall-clock time in `timeZone`. A time skipped by a DST
 * gap resolves forward; an ambiguous one resolves to the earlier instant.
 */
export function zonedTimeToInstant(key: string, timeZone: string, hour = 0, minute = 0): Date {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`not a date key: ${key}`);
  const wall = Date.UTC(p.year, p.month - 1, p.day, hour, minute);
  // The offsets in force half a day either side cover any transition that
  // day. A candidate is right when it reads back as the same wall time.
  const HALF_DAY = 12 * 60 * 60 * 1000;
  const candidates = [
    ...new Set([
      wall - offsetAt(wall - HALF_DAY, timeZone),
      wall - offsetAt(wall + HALF_DAY, timeZone),
    ]),
  ];
  const matches = candidates.filter((t) => {
    const back = zonedParts(new Date(t), timeZone);
    return Date.UTC(back.year, back.month - 1, back.day, back.hour, back.minute) === wall;
  });
  if (matches.length > 0) return new Date(Math.min(...matches));
  // In a DST gap: the later candidate is the wall time moved forward.
  return new Date(Math.max(...candidates));
}

/** Local midnight at the start of `key` in `timeZone`. */
export function zonedMidnight(key: string, timeZone: string): Date {
  return zonedTimeToInstant(key, timeZone, 0, 0);
}

export interface AllDaySpan {
  /** First day, "YYYY-MM-DD". */
  start: string;
  /** The day AFTER the last day, "YYYY-MM-DD" (exclusive, like ICS DTEND and Google end.date). */
  endExclusive: string;
  /** The last day, "YYYY-MM-DD". */
  lastDay: string;
}

/**
 * The days an all-day event covers, in `timeZone`. Accepts the exclusive
 * (midnight after the last day) and the older inclusive (23:59:59 on the last
 * day) end conventions; an end at or before the start means one day.
 */
export function allDaySpan(startsAt: Date, endsAt: Date, timeZone: string): AllDaySpan {
  const start = zonedDateKey(startsAt, timeZone);
  let lastDay =
    endsAt.getTime() > startsAt.getTime()
      ? zonedDateKey(new Date(endsAt.getTime() - 1), timeZone)
      : start;
  if (lastDay < start) lastDay = start;
  return { start, lastDay, endExclusive: addDaysToKey(lastDay, 1) };
}

/**
 * Stored instants for an all-day event from its first and last day (both
 * inclusive, "YYYY-MM-DD"): local midnight of the first day, and local
 * midnight after the last day.
 */
export function allDayInstants(
  firstDay: string,
  lastDay: string,
  timeZone: string,
): { startsAt: Date; endsAt: Date } {
  const last = lastDay < firstDay ? firstDay : lastDay;
  return {
    startsAt: zonedMidnight(firstDay, timeZone),
    endsAt: zonedMidnight(addDaysToKey(last, 1), timeZone),
  };
}

/** "YYYY-MM-DDTHH:mm" wall-clock time of `date` in `timeZone` (datetime-local inputs). */
export function zonedDateTimeLocal(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parses "YYYY-MM-DDTHH:mm" as a wall-clock time in `timeZone`. */
export function parseZonedDateTimeLocal(value: string, timeZone: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim());
  if (!m || !parseDateKey(m[1])) return null;
  const hour = Number(m[2]);
  const minute = Number(m[3]);
  if (hour > 23 || minute > 59) return null;
  return zonedTimeToInstant(m[1], timeZone, hour, minute);
}
