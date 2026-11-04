import { addDaysToKey, localDateKey, weekdayOfKey } from "@/lib/tasks/dates";

import {
  DAY_NAMES,
  ISO_DAYS,
  minuteLabel,
  rangesOn,
  type DateOverride,
  type IsoDay,
  type MinuteRange,
  type WeeklyHours,
} from "./hours";

/**
 * A booking link's hours as a picture (Meetings > Booking links): the next
 * seven days in the link's zone, one-off dates included, so a day off shows
 * as one. Pure; the loader works it out, so the first paint and the browser
 * agree.
 */

export interface WeekDay {
  /** YYYY-MM-DD in the link's zone. */
  key: string;
  /** "Monday". */
  name: string;
  today: boolean;
  ranges: readonly MinuteRange[];
}

export function comingWeek(
  hours: WeeklyHours,
  overrides: readonly DateOverride[],
  tz: string,
  now: Date,
): WeekDay[] {
  const today = localDateKey(now, tz);
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDaysToKey(today, i);
    const iso = weekdayOfKey(key) || 7;
    return {
      key,
      name: DAY_NAMES[String(iso) as IsoDay],
      today: i === 0,
      ranges: rangesOn(hours, overrides, key, iso),
    };
  });
}

/** The hours a picture covers: 8 to 6, stretched to fit whatever is free. */
export function weekWindow(days: readonly WeekDay[]): { from: number; to: number } {
  const ranges = days.flatMap((d) => d.ranges);
  const from = Math.min(480, ...ranges.map((r) => r[0]));
  const to = Math.max(1080, ...ranges.map((r) => r[1]));
  return { from: Math.floor(from / 60) * 60, to: Math.ceil(to / 60) * 60 };
}

/**
 * The week in a few words, for a strip or a card: "Mon to Fri, 9 AM to 5 PM",
 * "Tuesdays, 9 AM to 12 PM", or "4 days a week" when the days differ.
 */
export function hoursShort(hours: WeeklyHours): string {
  const line = (rs: readonly MinuteRange[]) =>
    rs.map(([s, e]) => `${minuteLabel(s)} to ${minuteLabel(e)}`).join(" and ");
  const short = (d: IsoDay) => DAY_NAMES[d].slice(0, 3);
  const open = ISO_DAYS.filter((d) => hours[d].length > 0);
  if (open.length === 0) return "No times set";
  const first = line(hours[open[0]!]);
  const same = open.every((d) => line(hours[d]) === first);
  const inARow = open.every((d, i) => i === 0 || Number(d) === Number(open[i - 1]) + 1);
  if (same && open.length === 1) return `${DAY_NAMES[open[0]!]}s, ${first}`;
  if (same && inARow) return `${short(open[0]!)} to ${short(open[open.length - 1]!)}, ${first}`;
  return open.length === 1 ? "1 day a week" : `${open.length} days a week`;
}

/** "30 minutes", "30 or 60 minutes", "15, 30 or 60 minutes". */
export function lengthsLine(durations: readonly number[]): string {
  if (durations.length < 2) return `${durations[0] ?? 30} minutes`;
  const last = durations[durations.length - 1];
  return `${durations.slice(0, -1).join(", ")} or ${last} minutes`;
}
