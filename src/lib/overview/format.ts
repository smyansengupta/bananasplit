import { addDaysToKey, daysBetweenKeys, formatDueKey, localDateKey } from "@/lib/tasks/dates";

/**
 * The Overview's date words (docs/design/moonstone.md, Dates): "Today",
 * "Tomorrow", then "Wed, Oct 14". Pure and client-safe.
 */

export type DueTone = "danger" | "bold" | "muted";

/** A task's due label and how loud it is. */
export function dueLabel(dueKey: string, todayKey: string): { text: string; tone: DueTone } {
  if (dueKey < todayKey)
    return { text: `Overdue, ${formatDueKey(dueKey, todayKey)}`, tone: "danger" };
  if (dueKey === todayKey) return { text: "Today", tone: "danger" };
  if (dueKey === addDaysToKey(todayKey, 1)) return { text: "Tomorrow", tone: "bold" };
  return { text: formatDueKey(dueKey, todayKey), tone: "muted" };
}

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

/** "Today", "Tomorrow", "Thu" within the week, else "Wed, Oct 21", for the day `key`. */
export function dayWordOfKey(key: string, todayKey: string): string {
  const days = daysBetweenKeys(todayKey, key);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) return WEEKDAY.format(new Date(`${key}T00:00:00Z`));
  return formatDueKey(key, todayKey);
}

/** "7:00 PM" in `timeZone`. */
export function timeWord(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(
    at,
  );
}

/**
 * "Tomorrow, 7:00 PM" in the viewer's zone; an all-day event is a whole
 * day in the club's zone ("Thu, all day").
 */
export function whenWord(
  at: Date,
  allDay: boolean,
  zones: { viewer: string; org: string },
  now: Date,
): string {
  const key = localDateKey(at, allDay ? zones.org : zones.viewer);
  const day = dayWordOfKey(key, localDateKey(now, zones.viewer));
  return allDay ? `${day}, all day` : `${day}, ${timeWord(at, zones.viewer)}`;
}
