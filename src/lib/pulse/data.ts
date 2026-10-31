import { z } from "zod";

import { addDaysToKey, isDateKey } from "@/lib/tasks/dates";

/**
 * The weekly pulse's stored shape (PulseIssue.data, version 1; the seed
 * documents the same fields as PulseIssueData in prisma/seed.ts). Version 1
 * may also carry `epicsFinished` and `summary`: optional, so an issue
 * written before them (the seed's) still reads.
 *
 * Nothing about money is ever stored here: the finance summary is worked
 * out when a finance role opens the issue (src/server/pulse/finance.ts).
 *
 * Pure and client-safe.
 */

const isoInstant = z.string().max(40);
const dateKey = z.string().refine(isDateKey, "a date key");

export const pulseIssueDataSchema = z.object({
  v: z.literal(1),
  range: z.object({ from: dateKey, to: dateKey }),
  doneCount: z.number().int().min(0),
  byProject: z
    .array(
      z.object({
        projectId: z.string().nullable(),
        name: z.string(),
        color: z.string().nullable(),
        done: z.number().int().min(0),
        open: z.number().int().min(0),
      }),
    )
    .catch([]),
  /** Epics finished in the range, with how many of their children were done. */
  epicsFinished: z
    .array(z.object({ id: z.string(), title: z.string(), project: z.string().nullable() }))
    .optional()
    .catch(undefined),
  events: z
    .array(
      z.object({
        eventId: z.string(),
        title: z.string(),
        startsAt: isoInstant,
        checkIns: z.number().int().min(0),
      }),
    )
    .catch([]),
  newMembers: z
    .array(
      z.object({
        userId: z.string().nullable(),
        contactId: z.string().nullable(),
        name: z.string(),
        joinedAt: isoInstant,
      }),
    )
    .catch([]),
  pollResults: z
    .array(
      z.object({
        kind: z.enum(["poll", "ballot"]),
        pollId: z.string(),
        question: z.string(),
        totalVotes: z.number().int().min(0),
        options: z.array(z.object({ label: z.string(), votes: z.number().int().min(0) })),
      }),
    )
    .catch([]),
  nextWeek: z
    .array(
      z.object({
        kind: z.enum(["task", "event"]),
        id: z.string(),
        title: z.string(),
        date: dateKey,
        ownerId: z.string().nullable(),
      }),
    )
    .catch([]),
  /** Team Advanced: Claude's two-sentence summary, written when the issue was compiled. */
  summary: z.string().max(600).optional().catch(undefined),
});

export type PulseIssueData = z.infer<typeof pulseIssueDataSchema>;

/** A stored issue's data, or null when it isn't a shape this version reads. */
export function parsePulseData(raw: unknown): PulseIssueData | null {
  const parsed = pulseIssueDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The finance lines a finance role sees (never stored). Whole cents. */
export interface PulseFinance {
  inCents: number;
  outCents: number;
  /** Expenses waiting for a treasurer. */
  pendingReimbursements: number;
}

// ---------------------------------------------------------------- wording

const SHORT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" });

function keyDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/** "Oct 5 to Oct 11". */
export function pulseRangeLabel(range: { from: string; to: string }): string {
  return `${SHORT.format(keyDate(range.from))} to ${SHORT.format(keyDate(range.to))}`;
}

/** "Week of Oct 5 to Oct 11", the issue's title. */
export function pulseTitle(range: { from: string; to: string }): string {
  return `Week of ${pulseRangeLabel(range)}`;
}

/** The last day of the week starting on `weekStart`. */
export function pulseRangeOf(weekStart: string): { from: string; to: string } {
  return { from: weekStart, to: addDaysToKey(weekStart, 6) };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The one-line headline: "9 things done · 32 at the General meeting · 4 new members". */
export function pulseHeadline(data: PulseIssueData): string {
  const parts = [`${plural(data.doneCount, "thing")} done`];
  const biggest = [...data.events].sort((a, b) => b.checkIns - a.checkIns)[0];
  if (biggest && biggest.checkIns > 0) parts.push(`${biggest.checkIns} at the ${biggest.title}`);
  else if (data.events.length > 0) parts.push(plural(data.events.length, "event") + " held");
  if (data.newMembers.length > 0) parts.push(plural(data.newMembers.length, "new member"));
  return parts.join(" · ");
}

/** "Fall Showcase 5 · Recruitment 3 · Organization operations 1" (projects with work done, most first). */
export function pulseProjectLine(data: PulseIssueData, max = 4): string {
  const done = data.byProject.filter((p) => p.done > 0);
  // Only loose tasks: "No project 2" says nothing the count doesn't.
  if (done.every((p) => p.projectId === null)) return "";
  return done
    .sort((a, b) => b.done - a.done || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((p) => `${p.name} ${p.done}`)
    .join(" · ");
}

/** A poll's result in words: "Midnight blue won", or "Tied: A and B", or "No votes yet". */
export function pollOutcome(poll: PulseIssueData["pollResults"][number]): string {
  const [first, second] = [...poll.options].sort((a, b) => b.votes - a.votes);
  if (!first || first.votes === 0) return "No votes yet";
  if (second && second.votes === first.votes) return `Tied: ${first.label} and ${second.label}`;
  return `${first.label} won`;
}

/**
 * Next week's top items, deadlines and events together, soonest first:
 * "Officer meeting Tue · General meeting Thu · SAO application due Fri".
 */
export function pulseNextWeek(data: PulseIssueData, max = 3): { text: string; title: string }[] {
  return [...data.nextWeek]
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === "event" ? -1 : 1),
    )
    .slice(0, max)
    .map((item) => {
      const day = WEEKDAY.format(keyDate(item.date));
      return {
        title: item.title,
        text: item.kind === "task" ? `${item.title} due ${day}` : `${item.title} ${day}`,
      };
    });
}

export type PulseRowIcon = "epic" | "done" | "people" | "poll" | "calendar" | "member" | "money";

export interface PulseRow {
  icon: PulseRowIcon;
  title: string;
  detail: string | null;
}

/**
 * The issue's rows, in the guide's order (15.1): epics finished, work done
 * by project, events and how many came, decisions from polls, new members,
 * next week. The email and the issue page both render these.
 */
export function pulseRows(data: PulseIssueData): PulseRow[] {
  const rows: PulseRow[] = [];
  for (const epic of data.epicsFinished ?? []) {
    rows.push({ icon: "epic", title: `${epic.title} is done`, detail: epic.project });
  }
  rows.push({
    icon: "done",
    title:
      data.doneCount === 0
        ? "Nothing finished this week"
        : `${plural(data.doneCount, "task")} finished`,
    detail: pulseProjectLine(data) || null,
  });
  for (const event of data.events.slice(0, 4)) {
    rows.push({
      icon: "people",
      title:
        event.checkIns > 0
          ? `${event.checkIns} came to the ${event.title}`
          : `${event.title} was held`,
      detail: null,
    });
  }
  for (const poll of data.pollResults.slice(0, 3)) {
    rows.push({
      icon: "poll",
      title: `${poll.question}: ${pollOutcome(poll)}`,
      detail: `${plural(poll.totalVotes, "vote")}.`,
    });
  }
  if (data.newMembers.length > 0) {
    const names = data.newMembers.slice(0, 3).map((m) => m.name);
    const more = data.newMembers.length - names.length;
    rows.push({
      icon: "member",
      title: `${plural(data.newMembers.length, "new member")} joined`,
      detail: more > 0 ? `${names.join(", ")} and ${more} more` : names.join(", "),
    });
  }
  const next = pulseNextWeek(data);
  rows.push({
    icon: "calendar",
    title: "Next week",
    detail: next.length > 0 ? next.map((n) => n.text).join(" · ") : "Nothing on the calendar yet",
  });
  return rows;
}
