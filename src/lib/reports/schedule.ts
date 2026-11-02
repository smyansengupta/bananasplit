import { z } from "zod";

/**
 * When a saved report emails itself. Each send keeps a copy (Report history)
 * and emails every recipient the report as THEY see it (each one's own
 * rows), so a schedule never sends anyone a row they couldn't open.
 *
 *   every  "week" (day: 0 = Sunday ... 6 = Saturday) or "month" (day: 1-28)
 *   hour   the organization's local hour, 6 to 20
 *   to     "me" (whoever set it), "admins" (owners and admins) or
 *          "everyone" (every member; a shared report only)
 */

export const SCHEDULE_TO = ["me", "admins", "everyone"] as const;
export type ScheduleTo = (typeof SCHEDULE_TO)[number];

export const reportScheduleSchema = z
  .object({
    every: z.enum(["week", "month"]),
    day: z.number().int().min(0).max(28),
    hour: z.number().int().min(6).max(20),
    to: z.enum(SCHEDULE_TO),
  })
  .strict()
  .refine((s) => (s.every === "week" ? s.day <= 6 : s.day >= 1), "Pick a day.");

export type ReportSchedule = z.infer<typeof reportScheduleSchema>;

export function readSchedule(raw: unknown): ReportSchedule | null {
  const parsed = reportScheduleSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const DEFAULT_SCHEDULE: ReportSchedule = { every: "week", day: 1, hour: 9, to: "me" };

function ordinal(n: number): string {
  const tail =
    n % 10 === 1 && n !== 11
      ? "st"
      : n % 10 === 2 && n !== 12
        ? "nd"
        : n % 10 === 3 && n !== 13
          ? "rd"
          : "th";
  return `${n}${tail}`;
}

export function hourLabel(hour: number): string {
  if (hour === 12) return "noon";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

const TO_LABEL: Record<ScheduleTo, string> = {
  me: "to you",
  admins: "to owners and admins",
  everyone: "to everyone",
};

/**
 * "Every Monday at 9 AM, to you"; "Mondays" for a card tag. `maker` names
 * who "me" is when someone else reads it ("to Jackson").
 */
export function describeSchedule(s: ReportSchedule, maker?: string | null): string {
  const when =
    s.every === "week" ? `Every ${WEEKDAYS[s.day]}` : `The ${ordinal(s.day)} of every month`;
  const to = s.to === "me" && maker ? `to ${maker}` : TO_LABEL[s.to];
  return `${when} at ${hourLabel(s.hour)}, ${to}`;
}

export function scheduleTag(s: ReportSchedule): string {
  return s.every === "week" ? `${WEEKDAYS[s.day]}s` : `Monthly, the ${ordinal(s.day)}`;
}

/** Whether the local date `dateKey` (yyyy-mm-dd, its weekday `weekday`) is a send day. */
export function isSendDay(s: ReportSchedule, dateKey: string, weekday: number): boolean {
  return s.every === "week" ? weekday === s.day : Number(dateKey.slice(8, 10)) === s.day;
}

function dayIn(tz: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * What a send covers: a weekly report the seven days up to the send, a
 * monthly one the calendar month before it, in the organization's timezone.
 */
export function sendRange(
  schedule: ReportSchedule,
  tz: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const today = dayIn(tz, now);
  if (schedule.every === "week") return { from: shift(today, -7), to: shift(today, -1) };
  const lastMonthEnd = shift(`${today.slice(0, 7)}-01`, -1);
  return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
}
