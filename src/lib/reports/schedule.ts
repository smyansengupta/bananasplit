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

/** "Every Monday at 9 AM, to you"; "Mondays" for a card tag. */
export function describeSchedule(s: ReportSchedule): string {
  const when =
    s.every === "week" ? `Every ${WEEKDAYS[s.day]}` : `The ${ordinal(s.day)} of every month`;
  return `${when} at ${hourLabel(s.hour)}, ${TO_LABEL[s.to]}`;
}

export function scheduleTag(s: ReportSchedule): string {
  return s.every === "week" ? `${WEEKDAYS[s.day]}s` : `Monthly, the ${ordinal(s.day)}`;
}

/** Whether the local date `dateKey` (yyyy-mm-dd, its weekday `weekday`) is a send day. */
export function isSendDay(s: ReportSchedule, dateKey: string, weekday: number): boolean {
  return s.every === "week" ? weekday === s.day : Number(dateKey.slice(8, 10)) === s.day;
}
