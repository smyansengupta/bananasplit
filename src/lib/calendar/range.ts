import { addDaysToKey, parseDateKey, safeTimeZone, zonedDateKey, zonedMidnight } from "./dates";

/**
 * The calendar page's visible window, carried in the URL so the server
 * queries only what FullCalendar shows (datesSet -> ?from=&to=).
 *
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   first day and the day AFTER the last
 *                                    (FullCalendar's exclusive end)
 *   &view=dayGridMonth|timeGridWeek|timeGridDay|listMonth
 *   &kind=WORKSHOP,SOCIAL            optional filters
 *   &vis=PUBLIC|INTERNAL
 *
 * Days are read in the org timezone; the window is padded by a day on each
 * side so viewers in other timezones never miss an edge event. A missing or
 * malformed window defaults to the month grid around today, and a window is
 * capped at 100 days.
 */

export const CALENDAR_VIEWS = ["dayGridMonth", "timeGridWeek", "timeGridDay", "listMonth"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const EVENT_KINDS = [
  "WORKSHOP",
  "SOCIAL",
  "HACKATHON",
  "INFO_SESSION",
  "BOARD_MEETING",
  "OTHER",
] as const;
export type EventKindValue = (typeof EVENT_KINDS)[number];
export const EVENT_VISIBILITIES = ["PUBLIC", "INTERNAL"] as const;
export type EventVisibilityValue = (typeof EVENT_VISIBILITIES)[number];

const MAX_DAYS = 100;

export interface CalendarRange {
  /** First visible day, YYYY-MM-DD. */
  fromKey: string;
  /** Day after the last visible day, YYYY-MM-DD. */
  toKey: string;
  /** Query bounds (padded by a day): events with startsAt < to and endsAt > from. */
  from: Date;
  to: Date;
  view: CalendarView;
  kinds: EventKindValue[];
  visibility: EventVisibilityValue | null;
}

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function daysBetween(a: string, b: string): number {
  const pa = parseDateKey(a)!;
  const pb = parseDateKey(b)!;
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) /
      86_400_000,
  );
}

/** The default month-grid window around `now`: six weeks from the Sunday on or before the 1st. */
export function defaultWindow(now: Date, timeZone: string): { fromKey: string; toKey: string } {
  const today = zonedDateKey(now, timeZone);
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const p = parseDateKey(firstOfMonth)!;
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const fromKey = addDaysToKey(firstOfMonth, -weekday);
  return { fromKey, toKey: addDaysToKey(fromKey, 42) };
}

export function parseCalendarRange(
  params: Params,
  timeZoneRaw: string,
  now: Date = new Date(),
): CalendarRange {
  const timeZone = safeTimeZone(timeZoneRaw);
  let fromKey = first(params.from);
  let toKey = first(params.to);
  if (
    !fromKey ||
    !toKey ||
    !parseDateKey(fromKey) ||
    !parseDateKey(toKey) ||
    daysBetween(fromKey, toKey) < 1 ||
    daysBetween(fromKey, toKey) > MAX_DAYS
  ) {
    ({ fromKey, toKey } = defaultWindow(now, timeZone));
  }
  const viewRaw = first(params.view);
  const view = (CALENDAR_VIEWS as readonly string[]).includes(viewRaw ?? "")
    ? (viewRaw as CalendarView)
    : "dayGridMonth";
  const kinds = (first(params.kind) ?? "")
    .split(",")
    .filter((k): k is EventKindValue => (EVENT_KINDS as readonly string[]).includes(k));
  const visRaw = first(params.vis);
  const visibility = (EVENT_VISIBILITIES as readonly string[]).includes(visRaw ?? "")
    ? (visRaw as EventVisibilityValue)
    : null;
  return {
    fromKey,
    toKey,
    from: zonedMidnight(addDaysToKey(fromKey, -1), timeZone),
    to: zonedMidnight(addDaysToKey(toKey, 1), timeZone),
    view,
    kinds: [...new Set(kinds)],
    visibility,
  };
}

/** The query string for a window and filters (stable key order). */
export function calendarSearch(r: {
  fromKey: string;
  toKey: string;
  view: CalendarView;
  kinds: readonly string[];
  visibility: string | null;
}): string {
  const q = new URLSearchParams({ from: r.fromKey, to: r.toKey, view: r.view });
  if (r.kinds.length > 0) q.set("kind", r.kinds.join(","));
  if (r.visibility) q.set("vis", r.visibility);
  return q.toString();
}
