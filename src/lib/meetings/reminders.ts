import { z } from "zod";

/**
 * Reminder offsets: how many minutes before a meeting a reminder goes out
 * (docs/features/meetings.md). A meeting has its own list
 * (Event.reminderMinutes), and a new meeting starts from the organization's
 * (OrgSettings.meetingReminderMinutes).
 *
 * Plain values and wording, nothing that touches the database, so the
 * pickers in the browser and the reminder job on the server read the same
 * limits and say the same things.
 */

/** At most this many reminders per meeting. */
export const MAX_REMINDERS = 8;

/** Four weeks, the furthest ahead a reminder can be. */
export const MAX_REMINDER_MINUTES = 40320;

/** What a meeting gets when neither it nor its organization says: a day's notice and an hour's. */
export const DEFAULT_REMINDER_MINUTES: readonly number[] = [1440, 60];

/** The times the pickers offer, earliest first. Any other time in range is still valid; these are the ones worth a button. */
export const REMINDER_CHOICES: readonly number[] = [10080, 2880, 1440, 120, 60, 30, 10];

/**
 * A list of offsets, as the database accepts it (app.reminder_offsets_ok: at
 * most 8, each 1-40320, no duplicates), so a bad list is a sentence for the
 * person rather than a constraint violation. The result is a new plain array,
 * earliest reminder first, which is the order every reader wants. An empty
 * list is valid: no reminders.
 */
export const reminderOffsetsSchema = z
  .array(
    z
      .number()
      .int("Reminder times are whole minutes.")
      .min(1, "A reminder is at least a minute before the meeting.")
      .max(MAX_REMINDER_MINUTES, "A reminder is at most four weeks before the meeting."),
  )
  .max(MAX_REMINDERS, `Use at most ${MAX_REMINDERS} reminders.`)
  .refine(
    (offsets) => new Set(offsets).size === offsets.length,
    "Each reminder time can only be used once.",
  )
  .transform((offsets) => [...offsets].sort((a, b) => b - a));

/**
 * Whether two lists are the same reminder times, whatever order they are in:
 * "does this meeting differ from the default", "has the picker changed".
 */
export function sameReminderOffsets(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const inB = new Set(b);
  return a.every((minutes) => inB.has(minutes));
}

const HOUR = 60;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

type Unit = "week" | "day" | "hour" | "minute";

/** The largest of a week, a day or an hour that `minutes` is a whole number of, else minutes. */
function unitOf(minutes: number): { count: number; unit: Unit } {
  if (minutes >= WEEK && minutes % WEEK === 0) return { count: minutes / WEEK, unit: "week" };
  if (minutes >= DAY && minutes % DAY === 0) return { count: minutes / DAY, unit: "day" };
  if (minutes >= HOUR && minutes % HOUR === 0) return { count: minutes / HOUR, unit: "hour" };
  return { count: minutes, unit: "minute" };
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** How a reminder time reads in a list or a picker: "1 hour before", "2 days before", "90 minutes before". */
export function reminderLabel(minutes: number): string {
  const { count, unit } = unitOf(minutes);
  return `${plural(count, unit)} before`;
}

/** What a reminder of exactly one of a unit says. A day out is "tomorrow", because that is how people say it. */
const ONE_AHEAD: Record<Unit, string> = {
  week: "in a week",
  day: "tomorrow",
  hour: "in an hour",
  minute: "in a minute",
};

/**
 * How a reminder opens, from the reader's side: "in an hour", "tomorrow",
 * "in 90 minutes".
 */
export function reminderLead(minutes: number): string {
  const { count, unit } = unitOf(minutes);
  return count === 1 ? ONE_AHEAD[unit] : `in ${plural(count, unit)}`;
}
