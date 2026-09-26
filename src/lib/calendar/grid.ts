import { addDaysToKey, parseDateKey } from "./dates";

/**
 * Layout maths for the calendar's own month, week and agenda renderers.
 *
 * Pure and client-safe: no React, no server imports, no Date formatting that
 * depends on a locale file. The calendar page renders these three views
 * itself rather than handing the window to a calendar library, so this is
 * where "which day does this event sit on" and "where does it sit in an
 * hour column" are decided once and tested once.
 *
 * TWO TIMEZONES, DELIBERATELY. Timed events are bucketed by the VIEWER's
 * local day, because their times are shown in the viewer's own timezone.
 * All-day events arrive already resolved to org-timezone day keys
 * ("YYYY-MM-DD", with an exclusive end, see lib/calendar/dates.ts) and are
 * bucketed by those keys untouched, so an all-day event covers the same days
 * for everyone. Mixing the two would drift an all-day event by a day for a
 * viewer west of the org.
 */

/** The minimum an item needs for layout. Views add their own fields. */
export interface GridItem {
  id: string;
  /** Timed: an ISO instant. All-day: "YYYY-MM-DD". */
  start: string;
  /** Timed: an ISO instant. All-day: the day AFTER the last day. */
  end: string;
  allDay: boolean;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "YYYY-MM-DD" for a Date in the runtime's local zone. */
export function localDayKey(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight at the start of a day key. */
export function localMidnight(key: string): Date {
  const p = parseDateKey(key);
  if (!p) throw new RangeError(`not a date key: ${key}`);
  return new Date(p.year, p.month - 1, p.day);
}

/** Minutes from local midnight, for a Date on a given local day. */
function minutesInto(day: string, at: Date): number {
  return (at.getTime() - localMidnight(day).getTime()) / 60_000;
}

/**
 * Every day key an item covers, first to last.
 *
 * A timed event that ends exactly at midnight belongs to the day it started,
 * not to the next one: a 9pm-to-midnight social is a Friday event.
 */
export function itemDayKeys(item: GridItem): string[] {
  if (item.allDay) {
    const last = addDaysToKey(item.end, -1);
    const first = item.start;
    if (last < first) return [first];
    const out: string[] = [];
    for (let key = first; key <= last; key = addDaysToKey(key, 1)) out.push(key);
    return out;
  }
  const start = new Date(item.start);
  const end = new Date(item.end);
  const first = localDayKey(start);
  if (!(end.getTime() > start.getTime())) return [first];
  // Step back a millisecond so a midnight end lands on the previous day.
  const last = localDayKey(new Date(end.getTime() - 1));
  if (last <= first) return [first];
  const out: string[] = [];
  for (let key = first; key <= last; key = addDaysToKey(key, 1)) out.push(key);
  return out;
}

/** Items bucketed by day key, each bucket in start order. */
export function bucketByDay<T extends GridItem>(items: readonly T[]): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    for (const key of itemDayKeys(item)) {
      const bucket = byDay.get(key);
      if (bucket) bucket.push(item);
      else byDay.set(key, [item]);
    }
  }
  for (const bucket of byDay.values()) bucket.sort(compareForDay);
  return byDay;
}

/** All-day first, then by start, then by title-stable id. */
function compareForDay(a: GridItem, b: GridItem): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  if (a.allDay) return a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1;
  const d = new Date(a.start).getTime() - new Date(b.start).getTime();
  return d !== 0 ? d : a.id < b.id ? -1 : 1;
}

export interface MonthCell {
  /** "YYYY-MM-DD". */
  key: string;
  /** Day of the month, 1-31. */
  day: number;
  /** False for the leading and trailing days of the neighbouring months. */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

export interface MonthGridShape {
  /** Rows of seven, Sunday first. */
  rows: MonthCell[][];
  /** The month the window is "about": the one most of its days belong to. */
  monthKey: string;
}

/**
 * The month grid's cells for a window that starts on a Sunday.
 *
 * The window comes from the URL (six weeks from the Sunday on or before the
 * 1st, see lib/calendar/range.ts), so the shape follows the data that was
 * actually fetched rather than recomputing a month and asking for days the
 * server never sent.
 */
export function monthGridShape(fromKey: string, dayCount: number, todayKey: string): MonthGridShape {
  const cells: MonthCell[] = [];
  const monthCounts = new Map<string, number>();
  for (let i = 0; i < dayCount; i += 1) {
    const key = addDaysToKey(fromKey, i);
    const month = key.slice(0, 7);
    monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
    cells.push({
      key,
      day: Number(key.slice(8, 10)),
      inMonth: true,
      isToday: key === todayKey,
      isWeekend: i % 7 === 0 || i % 7 === 6,
    });
  }
  let monthKey = fromKey.slice(0, 7);
  let best = -1;
  for (const [month, count] of monthCounts) {
    if (count > best) {
      best = count;
      monthKey = month;
    }
  }
  for (const cell of cells) cell.inMonth = cell.key.slice(0, 7) === monthKey;

  const rows: MonthCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return { rows, monthKey };
}

/** The day keys of a window, first to last. */
export function dayKeysBetween(fromKey: string, dayCount: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < dayCount; i += 1) out.push(addDaysToKey(fromKey, i));
  return out;
}

export interface PlacedItem<T> {
  item: T;
  /** Minutes from local midnight, clamped into the day. */
  startMinutes: number;
  endMinutes: number;
  /** Column index within its overlap cluster, and how many columns that cluster has. */
  lane: number;
  lanes: number;
  /** True when the event began before this day (a multi-day event's later days). */
  continuesFrom: boolean;
  /** True when the event runs past midnight into the next day. */
  continuesInto: boolean;
}

/** The shortest slot a placed event is drawn as, so a 15-minute event stays readable. */
export const MIN_SLOT_MINUTES = 30;

/**
 * Lays a day's timed events out in an hour column: clamps each to the day,
 * then packs overlapping events into side-by-side lanes.
 *
 * Events are grouped into clusters of transitively overlapping events, and a
 * cluster's width is the largest number of events overlapping at any instant
 * in it. Within a cluster each event takes the first lane free at its start,
 * which is the layout every calendar app uses and which keeps a long event
 * from pushing every later event one lane further right.
 *
 * Overlap is measured on the DRAWN height (MIN_SLOT_MINUTES), not the real
 * duration, so two back-to-back 15-minute events that visually collide are
 * given their own lanes instead of being drawn on top of each other.
 */
export function placeDayItems<T extends GridItem>(dayKey: string, items: readonly T[]): PlacedItem<T>[] {
  const midnight = localMidnight(dayKey).getTime();
  const nextMidnight = localMidnight(addDaysToKey(dayKey, 1)).getTime();

  const placed: PlacedItem<T>[] = items
    .filter((item) => !item.allDay)
    .map((item) => {
      const start = new Date(item.start).getTime();
      const end = Math.max(new Date(item.end).getTime(), start);
      const startMinutes = Math.max(0, minutesInto(dayKey, new Date(Math.max(start, midnight))));
      const rawEnd = Math.min(end, nextMidnight);
      const endMinutes = Math.min(1440, Math.max(startMinutes + 1, minutesInto(dayKey, new Date(rawEnd))));
      return {
        item,
        startMinutes,
        endMinutes,
        lane: 0,
        lanes: 1,
        continuesFrom: start < midnight,
        continuesInto: end > nextMidnight,
      };
    })
    .sort((a, b) => a.startMinutes - b.startMinutes || b.endMinutes - a.endMinutes);

  const drawnEnd = (p: PlacedItem<T>) => Math.max(p.endMinutes, p.startMinutes + MIN_SLOT_MINUTES);

  let cluster: PlacedItem<T>[] = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    for (const p of cluster) {
      let lane = laneEnds.findIndex((end) => end <= p.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = drawnEnd(p);
      p.lane = lane;
    }
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    clusterEnd = -1;
  };

  for (const p of placed) {
    if (cluster.length > 0 && p.startMinutes >= clusterEnd) closeCluster();
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, drawnEnd(p));
  }
  closeCluster();

  return placed;
}

/**
 * The hour window an hour column should open on: an hour before the earliest
 * event and an hour after the latest, widened to at least `minHours` and
 * never outside the day.
 *
 * A student club runs evenings, so opening on 12am (which is what a
 * full-day column does) spends the whole viewport on hours nothing happens
 * in. This is what replaces that.
 */
export function visibleHourRange(
  placements: readonly { startMinutes: number; endMinutes: number }[],
  { minHours = 10, fallbackStart = 8 }: { minHours?: number; fallbackStart?: number } = {},
): { startHour: number; endHour: number } {
  if (placements.length === 0) {
    const endHour = Math.min(24, fallbackStart + minHours);
    return { startHour: Math.max(0, endHour - minHours), endHour };
  }
  let min = Infinity;
  let max = -Infinity;
  for (const p of placements) {
    min = Math.min(min, p.startMinutes);
    max = Math.max(max, p.endMinutes);
  }
  let startHour = Math.max(0, Math.floor(min / 60) - 1);
  let endHour = Math.min(24, Math.ceil(max / 60) + 1);
  while (endHour - startHour < minHours) {
    if (endHour < 24) endHour += 1;
    else if (startHour > 0) startHour -= 1;
    else break;
  }
  return { startHour, endHour };
}

export interface AgendaDay<T> {
  key: string;
  items: T[];
}

/** Days that have something on them, in order, each with its items. */
export function agendaDays<T extends GridItem>(items: readonly T[], fromKey: string, dayCount: number): AgendaDay<T>[] {
  const byDay = bucketByDay(items);
  const out: AgendaDay<T>[] = [];
  for (const key of dayKeysBetween(fromKey, dayCount)) {
    const dayItems = byDay.get(key);
    if (dayItems && dayItems.length > 0) out.push({ key, items: dayItems });
  }
  return out;
}

/** Day of the week for a date key, 0 = Sunday. */
export function weekdayOf(dayKey: string): number {
  const p = parseDateKey(dayKey);
  if (!p) return 0;
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** The six-week month window: from the Sunday on or before the 1st. */
export function monthWindowFor(monthKey: string): { fromKey: string; toKey: string } {
  const first = `${monthKey}-01`;
  const fromKey = addDaysToKey(first, -weekdayOf(first));
  return { fromKey, toKey: addDaysToKey(fromKey, 42) };
}

/** The week containing a day, Sunday first. */
export function weekWindowFor(dayKey: string): { fromKey: string; toKey: string } {
  const fromKey = addDaysToKey(dayKey, -weekdayOf(dayKey));
  return { fromKey, toKey: addDaysToKey(fromKey, 7) };
}

/** The single-day window for a day. */
export function dayWindowFor(dayKey: string): { fromKey: string; toKey: string } {
  return { fromKey: dayKey, toKey: addDaysToKey(dayKey, 1) };
}

/** A month key ("YYYY-MM") moved by whole months. */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}`;
}

/** How many days a window covers. */
export function windowDays(fromKey: string, toKey: string): number {
  const a = parseDateKey(fromKey);
  const b = parseDateKey(toKey);
  if (!a || !b) return 42;
  return Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000,
  );
}
