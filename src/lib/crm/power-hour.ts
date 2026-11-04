import { addDaysToKey, localDateKey, localHour, zonedInstant } from "@/lib/tasks/dates";

/**
 * Power hour on Today (docs/features/crm.md, "Redesign"): work the list one
 * person at a time. Pure helpers for the strip and the card.
 */

/** The member's snooze of the strip, an InboxItemState row of their own (not a "crm:" queue key). */
export const POWER_HOUR_KEY = "crm-power-hour";

/** The afternoon hour the strip comes back at, local time. */
export const POWER_HOUR_AFTERNOON = 14;
/** The morning hour it comes back at the next day. */
export const POWER_HOUR_MORNING = 8;

/**
 * When a snoozed Power hour comes back: 2 PM today when it's still the
 * morning where the member is, else 8 AM the next day.
 */
export function powerHourSnoozeUntil(now: Date, tz: string): Date {
  const today = localDateKey(now, tz);
  if (localHour(now, tz) < POWER_HOUR_AFTERNOON)
    return zonedInstant(today, POWER_HOUR_AFTERNOON, tz);
  return zonedInstant(addDaysToKey(today, 1), POWER_HOUR_MORNING, tz);
}

/** "Power hour is back at 2 PM" or "... tomorrow morning". */
export function powerHourBackLabel(until: Date, now: Date, tz: string): string {
  const sameDay = localDateKey(until, tz) === localDateKey(now, tz);
  if (!sameDay) return "Power hour is back tomorrow morning";
  const time = until
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz })
    .replace(":00", "");
  return `Power hour is back at ${time}`;
}

/** About how long a run takes: six minutes a person, rounded to five, never under five. */
export function powerHourMinutes(people: number): number {
  if (people <= 0) return 0;
  return Math.max(5, Math.round((people * 6) / 5) * 5);
}
