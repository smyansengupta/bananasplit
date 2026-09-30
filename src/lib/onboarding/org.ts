import { TZDate } from "@date-fns/tz";
import { z } from "zod";

import { FINANCE_CARD_IDS } from "@/lib/finance/dashboard-cards";
import { localDateKey } from "@/lib/tasks/dates";

/**
 * Org setup (Flow B) inputs, shared by the step forms and their Server
 * Actions. Pure and client-safe.
 */

// ---------------------------------------------------------------- B3 labels

export const DATA_TAGS = ["Finance", "People", "Operations", "Events", "Other"] as const;
export type DataTag = (typeof DATA_TAGS)[number];

export function isDataTag(value: unknown): value is DataTag {
  return typeof value === "string" && (DATA_TAGS as readonly string[]).includes(value);
}

/** The suggested tag for a built-in database, before anyone picks one. */
export function defaultTagForKind(kind: string): DataTag {
  switch (kind) {
    case "PEOPLE":
    case "SIGNUPS":
      return "People";
    case "SESSIONS":
    case "ATTENDANCE":
      return "Events";
    case "BALLOTS":
      return "Operations";
    default:
      return "Other";
  }
}

/** MemberVisibility, in the words the select shows. */
export const VISIBILITY_OPTIONS = [
  { value: "MEMBERS", label: "Everyone in the org" },
  { value: "ADMINS", label: "Owners and admins" },
  { value: "OWNER", label: "Owners only" },
  { value: "HIDDEN", label: "Hidden from members' list" },
] as const;
export type VisibilityValue = (typeof VISIBILITY_OPTIONS)[number]["value"];
const visibilityValues = VISIBILITY_OPTIONS.map((o) => o.value) as [
  VisibilityValue,
  ...VisibilityValue[],
];

export const labelsInputSchema = z
  .object({
    sources: z
      .array(
        z
          .object({
            id: z.string().min(1).max(100),
            name: z
              .string()
              .transform((s) => s.replace(/\s+/g, " ").trim())
              .pipe(
                z
                  .string()
                  .min(1, "Give every source a label.")
                  .max(60, "Keep labels under 60 characters."),
              ),
            tag: z.enum(DATA_TAGS).nullable(),
          })
          .strict(),
      )
      .max(100),
    /** Who can see each tag's data: applied to every source with that tag. */
    visibility: z.partialRecord(z.enum(DATA_TAGS), z.enum(visibilityValues)),
  })
  .strict();

export type LabelsInput = z.input<typeof labelsInputSchema>;

// ---------------------------------------------------------------- B4 finance

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export const financeInputSchema = z
  .object({
    cards: z
      .array(z.enum(FINANCE_CARD_IDS as [string, ...string[]]))
      .min(1, "Keep at least one report.")
      .max(10),
    /** 1-12: the month the fiscal year starts on the 1st of. */
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    /** Create the budget period for the current fiscal year. */
    createPeriod: z.boolean(),
  })
  .strict();

export type FinanceInput = z.input<typeof financeInputSchema>;

/**
 * The fiscal year that contains `today` (a YYYY-MM-DD date in the org's
 * zone), starting on the 1st of `startMonth`: its label and its first and
 * last days.
 */
export function fiscalYearFor(
  today: string,
  startMonth: number,
): { label: string; startsOn: string; endsOn: string } {
  const [y, m] = today.split("-").map(Number);
  const startYear = m >= startMonth ? y : y - 1;
  const start = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, 1) - 24 * 60 * 60 * 1000);
  const endsOn = endDate.toISOString().slice(0, 10);
  const label =
    startMonth === 1
      ? `FY ${startYear}`
      : `FY ${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;
  return { label, startsOn: start, endsOn };
}

// ---------------------------------------------------------------- B5 teams

export const CADENCES = [
  { value: "weekly", label: "weekly" },
  { value: "biweekly", label: "every 2 weeks" },
] as const;
export type Cadence = (typeof CADENCES)[number]["value"];

export const MAX_TEAMS = 20;
/** Meetings added to the calendar: about one semester. */
export const MEETING_WEEKS_AHEAD = 12;

const meetingSchema = z
  .object({
    /** 0 = Monday. */
    day: z.number().int().min(0).max(6),
    /** Minutes after midnight, on the quarter hour. */
    minutes: z
      .number()
      .int()
      .min(0)
      .max(23 * 60 + 45)
      .multipleOf(15),
    cadence: z.enum(["weekly", "biweekly"]),
  })
  .strict();

export const teamsInputSchema = z
  .object({
    teams: z
      .array(
        z
          .object({
            name: z
              .string()
              .transform((s) => s.replace(/\s+/g, " ").trim())
              .pipe(
                z
                  .string()
                  .min(1, "Name every team.")
                  .max(80, "Keep team names under 80 characters."),
              ),
            leadUserId: z.string().min(1).max(100).nullable(),
            meeting: meetingSchema.nullable(),
          })
          .strict(),
      )
      .min(1, "Add at least one team.")
      .max(MAX_TEAMS, `Add at most ${MAX_TEAMS} teams.`),
    addMeetingsToCalendar: z.boolean(),
    showMemberAvailability: z.boolean(),
  })
  .strict();

export type TeamsInput = z.input<typeof teamsInputSchema>;
export type TeamInput = TeamsInput["teams"][number];
export type MeetingInput = z.input<typeof meetingSchema>;

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Mon 7 PM weekly", "Thu 5:30 PM every 2 weeks" */
export function describeMeeting(m: { day: number; minutes: number; cadence: string }): string {
  const h = Math.floor(m.minutes / 60);
  const min = m.minutes % 60;
  const h12 = ((h + 11) % 12) + 1;
  const time = `${h12}${min ? `:${String(min).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
  return `${DAY_NAMES[m.day]} ${time} ${m.cadence === "biweekly" ? "every 2 weeks" : "weekly"}`;
}

/** The next `count` meeting starts (UTC instants) at a local weekday/time in `tz`. */
export function meetingOccurrences(
  meeting: { day: number; minutes: number; cadence: "weekly" | "biweekly" },
  tz: string,
  now: Date,
  weeksAhead: number,
): Date[] {
  const today = localDateKey(now, tz);
  const [y, m, d] = today.split("-").map(Number);
  // Weekday of today in the org's zone, Monday = 0.
  const todayDow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  let offset = (meeting.day - todayDow + 7) % 7;
  const h = Math.floor(meeting.minutes / 60);
  const min = meeting.minutes % 60;
  const first = new TZDate(y, m - 1, d + offset, h, min, tz);
  if (first.getTime() <= now.getTime()) offset += 7;
  const step = meeting.cadence === "biweekly" ? 14 : 7;
  const out: Date[] = [];
  for (let days = offset; days < weeksAhead * 7; days += step) {
    out.push(new Date(new TZDate(y, m - 1, d + days, h, min, tz).getTime()));
  }
  return out;
}
