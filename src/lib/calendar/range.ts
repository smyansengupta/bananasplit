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
 *   &tasks=0                         hide tasks (their due dates show by default)
 *   &new=1|online|in-person|event    open New event (on that shape), then dropped
 *                                    (NEW_EVENT_PARAM; `rsvp` still means `event`)
 *
 * Days are read in the org timezone; the window is padded by a day on each
 * side so viewers in other timezones never miss an edge event. A missing or
 * malformed window defaults to the month grid around today, and a window is
 * capped at 100 days.
 */

export const CALENDAR_VIEWS = ["dayGridMonth", "timeGridWeek", "timeGridDay", "listMonth"] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const EVENT_KINDS = ["WORKSHOP", "SOCIAL", "HACKATHON", "INFO_SESSION", "BOARD_MEETING", "OTHER"] as const;
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
  /** Tasks' due dates on the grid, beside the events. */
  tasks: boolean;
}

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function daysBetween(a: string, b: string): number {
  const pa = parseDateKey(a)!;
  const pb = parseDateKey(b)!;
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86_400_000);
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

export function parseCalendarRange(params: Params, timeZoneRaw: string, now: Date = new Date()): CalendarRange {
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
  const view = (CALENDAR_VIEWS as readonly string[]).includes(viewRaw ?? "") ? (viewRaw as CalendarView) : "dayGridMonth";
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
    tasks: first(params.tasks) !== "0",
  };
}

/**
 * ?new=: opens the create form on arrival, then is dropped. `1` opens it with
 * nothing preset; `online`, `in-person` or `event` open it on that shape (see
 * `newMeetingAsk`, lib/meetings/shape.ts), and the old `rsvp` means `event`.
 * It is read by the Calendar and by Meetings, which are the two places that
 * open the form.
 */
export const NEW_EVENT_PARAM = "new";

/** A link that starts a new event, with its sign-up page, in Meetings. */
export function newRsvpEventHref(orgSlug: string): string {
  return `/app/${orgSlug}/meetings?${NEW_EVENT_PARAM}=event`;
}

/** The query string for a window and filters (stable key order). */
export function calendarSearch(r: {
  fromKey: string;
  toKey: string;
  view: CalendarView;
  kinds: readonly string[];
  visibility: string | null;
  tasks?: boolean;
}): string {
  const q = new URLSearchParams({ from: r.fromKey, to: r.toKey, view: r.view });
  if (r.kinds.length > 0) q.set("kind", r.kinds.join(","));
  if (r.visibility) q.set("vis", r.visibility);
  if (r.tasks === false) q.set("tasks", "0");
  return q.toString();
}
