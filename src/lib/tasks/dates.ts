import { TZDate } from "@date-fns/tz";

/**
 * Date helpers for tasks. Pure and client-safe.
 *
 * Due dates are FLOATING calendar dates: stored as UTC midnight of the day
 * ("2026-10-03T00:00:00Z" means "October 3", everywhere), read and written
 * through their UTC components, never shifted by a viewer's timezone.
 * A date key is the "YYYY-MM-DD" string of such a day.
 *
 * Instants (completedAt, reminder run times, the Sunday-update week) are
 * real moments, bucketed in a timezone: the user's own (User.timezone) or,
 * when that is unset, the org's (Organization.timezone).
 */

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isDateKey(value: string): boolean {
  const m = KEY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** "YYYY-MM-DD" of a stored floating due date. */
export function dueDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A date key as the stored floating due date (UTC midnight). */
export function fromDateKey(key: string): Date {
  if (!isDateKey(key)) throw new RangeError(`not a date key: ${key}`);
  return new Date(`${key}T00:00:00.000Z`);
}

export function addDaysToKey(key: string, days: number): string {
  const d = fromDateKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return dueDateKey(d);
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetweenKeys(a: string, b: string): number {
  return Math.round((fromDateKey(b).getTime() - fromDateKey(a).getTime()) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday, for a date key. */
export function weekdayOfKey(key: string): number {
  return fromDateKey(key).getUTCDay();
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The zone to bucket a user's instants in: theirs, else the org's, else UTC. */
export function effectiveTimezone(
  user: { timezone?: string | null } | null | undefined,
  org: { timezone?: string | null } | null | undefined,
): string {
  if (isValidTimeZone(user?.timezone)) return user.timezone;
  if (isValidTimeZone(org?.timezone)) return org.timezone;
  return "UTC";
}

/** The local calendar date of `instant` in `tz`. */
export function localDateKey(instant: Date, tz: string): string {
  const z = new TZDate(instant.getTime(), tz);
  return `${z.getFullYear()}-${pad(z.getMonth() + 1)}-${pad(z.getDate())}`;
}

/** The local hour (0-23) of `instant` in `tz`. */
export function localHour(instant: Date, tz: string): number {
  return new TZDate(instant.getTime(), tz).getHours();
}

/** The instant of hh:mm local time on the day `key` in `tz` (DST-aware). */
export function zonedInstant(key: string, hour: number, tz: string, minute = 0): Date {
  const m = KEY.exec(key);
  if (!m) throw new RangeError(`not a date key: ${key}`);
  const z = new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute, 0, tz);
  return new Date(z.getTime());
}

/** The Monday that starts the local week (Monday 00:00 to Sunday 23:59) containing `instant`. */
export function weekStartKey(instant: Date, tz: string): string {
  const today = localDateKey(instant, tz);
  const offset = (weekdayOfKey(today) + 6) % 7; // days since Monday
  return addDaysToKey(today, -offset);
}

/** The Monday of the week containing the date key (no timezone involved). */
export function mondayOfKey(key: string): string {
  return addDaysToKey(key, -((weekdayOfKey(key) + 6) % 7));
}

/** [start, end) instants of the local week starting on the Monday `weekStart`. */
export function weekBounds(weekStart: string, tz: string): { start: Date; end: Date } {
  return {
    start: zonedInstant(weekStart, 0, tz),
    end: zonedInstant(addDaysToKey(weekStart, 7), 0, tz),
  };
}

/** [start, end) instants of the local day `key`. */
export function dayBounds(key: string, tz: string): { start: Date; end: Date } {
  return { start: zonedInstant(key, 0, tz), end: zonedInstant(addDaysToKey(key, 1), 0, tz) };
}

const DUE_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const DUE_FORMAT_YEAR = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Fri, Oct 3" (with the year when it differs from `todayKey`'s). */
export function formatDueKey(key: string, todayKey?: string): string {
  const d = fromDateKey(key);
  const sameYear = todayKey ? todayKey.slice(0, 4) === key.slice(0, 4) : true;
  return (sameYear ? DUE_FORMAT : DUE_FORMAT_YEAR).format(d);
}

/** Buckets for My Tasks, relative to the viewer's local today. */
export type DueBucket = "overdue" | "today" | "thisWeek" | "later" | "none";

export function dueBucket(dueKey: string | null, todayKey: string): DueBucket {
  if (!dueKey) return "none";
  if (dueKey < todayKey) return "overdue";
  if (dueKey === todayKey) return "today";
  // "This week": through the Sunday that ends the viewer's current week.
  const sunday = addDaysToKey(mondayOfKey(todayKey), 6);
  if (dueKey <= sunday) return "thisWeek";
  return "later";
}
