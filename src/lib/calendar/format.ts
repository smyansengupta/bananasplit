import { addDaysToKey, allDaySpan, zonedDateKey } from "./dates";

/**
 * A one-line "when" for event lists outside the calendar, relative to today:
 * "Today, 6:00 PM – 7:30 PM", "Tomorrow, 6:00 PM – 8:00 PM", "Thu, Oct 8,
 * 11:00 PM – Fri, Oct 9, 1:00 AM". Timed events read in the viewer's zone;
 * all-day events are whole days in the org's zone, as everywhere else.
 * Client-safe.
 */

const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatTime(date: Date, timeZone: string): string {
  let f = timeFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
    timeFormatters.set(timeZone, f);
  }
  return f.format(date);
}

const DAY = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const DAY_WITH_YEAR = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  if (key === addDaysToKey(todayKey, 1)) return "Tomorrow";
  const date = new Date(`${key}T00:00:00Z`);
  return (key.slice(0, 4) === todayKey.slice(0, 4) ? DAY : DAY_WITH_YEAR).format(date);
}

export function formatEventWhen(
  event: { startsAt: Date; endsAt: Date; allDay: boolean },
  zones: { viewer: string; org: string },
  now: Date,
): string {
  if (event.allDay) {
    const span = allDaySpan(event.startsAt, event.endsAt, zones.org);
    const today = zonedDateKey(now, zones.org);
    const first = dayLabel(span.start, today);
    return span.lastDay === span.start
      ? `${first}, all day`
      : `${first} – ${dayLabel(span.lastDay, today)}, all day`;
  }

  const tz = zones.viewer;
  const today = zonedDateKey(now, tz);
  const startKey = zonedDateKey(event.startsAt, tz);
  const start = `${dayLabel(startKey, today)}, ${formatTime(event.startsAt, tz)}`;
  if (event.endsAt.getTime() <= event.startsAt.getTime()) return start;
  const endKey = zonedDateKey(event.endsAt, tz);
  return endKey === startKey
    ? `${start} – ${formatTime(event.endsAt, tz)}`
    : `${start} – ${dayLabel(endKey, today)}, ${formatTime(event.endsAt, tz)}`;
}
