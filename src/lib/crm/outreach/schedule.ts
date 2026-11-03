import { addDaysToKey, isValidTimeZone, localDateKey, localHour, weekdayOfKey, zonedInstant } from "@/lib/tasks/dates";

/**
 * When outreach goes out and comes back: a sequence's send window (days
 * of the week and hours, in the organization's timezone), keep-in-touch
 * cadences and when they lapse. Pure.
 */

/** {days: ISO weekdays 1 Monday .. 7 Sunday, startHour, endHour (exclusive)}. */
export interface SendWindow {
  days: number[];
  startHour: number;
  endHour: number;
}

export const DEFAULT_WINDOW: SendWindow = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 };

/**
 * When an automation's email may go (a welcome after a form, a receipt):
 * any day, waking hours in the organization's timezone, so nobody gets one
 * at 3 AM and a weekend sign-up still hears back the same day.
 */
export const AUTOMATION_WINDOW: SendWindow = { days: [1, 2, 3, 4, 5, 6, 7], startHour: 8, endHour: 21 };

/** A stored window, cleaned; anything odd falls back to weekdays 9 to 5. */
export function readWindow(raw: unknown): SendWindow {
  const w = (raw && typeof raw === "object" ? raw : {}) as Partial<SendWindow>;
  const days = Array.isArray(w.days)
    ? [...new Set(w.days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort()
    : [];
  const start = Number.isInteger(w.startHour) ? Math.min(Math.max(w.startHour!, 0), 23) : DEFAULT_WINDOW.startHour;
  const end = Number.isInteger(w.endHour) ? Math.min(Math.max(w.endHour!, 1), 24) : DEFAULT_WINDOW.endHour;
  return {
    days: days.length ? days : DEFAULT_WINDOW.days,
    startHour: end > start ? start : DEFAULT_WINDOW.startHour,
    endHour: end > start ? end : DEFAULT_WINDOW.endHour,
  };
}

/** ISO weekday (1 Monday .. 7 Sunday) of a date key. */
function isoDay(key: string): number {
  const d = weekdayOfKey(key);
  return d === 0 ? 7 : d;
}

/**
 * The first moment at or after `at` inside the window, in `tz`. Inside the
 * window it is `at` itself; otherwise the start of the next open day.
 */
export function nextInWindow(at: Date, window: SendWindow, tz: string): Date {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const key = localDateKey(at, zone);
  const hour = localHour(at, zone);
  if (window.days.includes(isoDay(key)) && hour >= window.startHour && hour < window.endHour) return at;
  // Later today, if today is open and the window hasn't started yet.
  if (window.days.includes(isoDay(key)) && hour < window.startHour) {
    return zonedInstant(key, window.startHour, zone);
  }
  for (let i = 1; i <= 8; i++) {
    const next = addDaysToKey(key, i);
    if (window.days.includes(isoDay(next))) return zonedInstant(next, window.startHour, zone);
  }
  return at;
}

/** "Weekdays, 9 AM to 5 PM" */
export function windowLabel(w: SendWindow): string {
  const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days =
    w.days.join() === "1,2,3,4,5"
      ? "Weekdays"
      : w.days.length === 7
        ? "Every day"
        : w.days.map((d) => names[d]).join(", ");
  const h = (n: number) => `${((n + 11) % 12) + 1} ${n < 12 || n === 24 ? "AM" : "PM"}`;
  return `${days}, ${h(w.startHour)} to ${h(w.endHour)}`;
}

// ---- Keep in touch -------------------------------------------------------------

export const CADENCES: readonly { days: number; label: string }[] = [
  { days: 7, label: "Every week" },
  { days: 14, label: "Every two weeks" },
  { days: 30, label: "Every month" },
  { days: 91, label: "Each quarter" },
  { days: 182, label: "Twice a year" },
  { days: 365, label: "Every year" },
];

export function cadenceLabel(days: number | null | undefined): string {
  if (!days) return "Not set";
  return CADENCES.find((c) => c.days === days)?.label ?? `Every ${days} days`;
}

/** When a cadence wants them next: last contact plus the cadence (now, if never). */
export function cadenceDue(lastContactedAt: Date | null, days: number, now: Date = new Date()): Date {
  if (!lastContactedAt) return now;
  return new Date(lastContactedAt.getTime() + days * 86_400_000);
}

/** Has their cadence lapsed? */
export function cadenceLapsed(lastContactedAt: Date | null, days: number | null, now: Date = new Date()): boolean {
  if (!days) return false;
  return cadenceDue(lastContactedAt, days, now).getTime() <= now.getTime();
}

/** Snooze choices on the queue, as a time from now. */
export const SNOOZES = {
  tomorrow: { label: "Tomorrow", days: 1 },
  week: { label: "Next week", days: 7 },
  month: { label: "In a month", days: 30 },
} as const;
export type SnoozeKey = keyof typeof SNOOZES;
