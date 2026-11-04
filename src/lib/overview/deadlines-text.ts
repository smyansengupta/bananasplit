import { dayWordOfKey } from "@/lib/overview/format";
import { daysBetweenKeys } from "@/lib/tasks/dates";

/**
 * Deadlines: every hard date in the next three weeks, whatever it comes
 * from (your tasks, forms and polls closing, elections, the budget
 * period), in one list by date, with a warning for one that's close and
 * not started. Pure; the loader gathers the items.
 */

export const DEADLINE_DAYS = 21;

export type DeadlineKind = "task" | "form" | "poll" | "election" | "finance";

export interface DeadlineItem {
  key: string;
  kind: DeadlineKind;
  /** The day it falls on, in the viewer's timezone ("2026-11-04"). */
  dayKey: string;
  title: string;
  /** Where it comes from, as text: "Task, yours", "Form, 34 responses". */
  source: string;
  href: string;
  /** Nothing has happened on it yet (a task not started, a form with no answers). */
  notStarted: boolean;
}

export type DeadlineTone = "soon" | "later" | "warn";

export interface DeadlineRow extends DeadlineItem {
  /** "Wed" within the week, else "Nov 8". */
  tag: string;
  tone: DeadlineTone;
}

export interface Deadlines {
  rows: DeadlineRow[];
  /** Every deadline found (the rows stop at a handful). */
  total: number;
  insight: string | null;
}

/**
 * "Today", "Tmrw", a weekday within the week, else "Nov 8": the Overview's
 * day word (dayWordOfKey), short enough for the tag, so past the week it
 * keeps the date without the weekday.
 */
export function deadlineTag(dayKey: string, todayKey: string): string {
  const word = dayWordOfKey(dayKey, todayKey);
  if (word === "Tomorrow") return "Tmrw";
  return word.replace(/^\w{3}, /, "");
}

/** The day as words for a sentence: "today", "tomorrow", "Fri", "Nov 8". */
function dayWords(dayKey: string, todayKey: string): string {
  const word = dayWordOfKey(dayKey, todayKey);
  if (word === "Today" || word === "Tomorrow") return word.toLowerCase();
  return deadlineTag(dayKey, todayKey);
}

/**
 * The one that needs starting: the soonest item within a week that
 * nothing has happened on yet.
 */
export function pickWarning(items: readonly DeadlineItem[], todayKey: string): DeadlineItem | null {
  return (
    [...items]
      .filter((i) => i.notStarted && daysBetweenKeys(todayKey, i.dayKey) <= 7)
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey))[0] ?? null
  );
}

/** The warning's words. Titles other than a task's already say what happens ("Applications close"). */
export function warningText(item: DeadlineItem, todayKey: string): string {
  const when = dayWords(item.dayKey, todayKey);
  if (item.kind === "task") return `${item.title} is due ${when} and isn't started.`;
  return `${item.title} ${when} with no answers yet.`;
}

export function buildDeadlines(
  items: readonly DeadlineItem[],
  todayKey: string,
  limit = 6,
): Deadlines {
  const sorted = [...items].sort(
    (a, b) => a.dayKey.localeCompare(b.dayKey) || a.title.localeCompare(b.title),
  );
  const warn = pickWarning(sorted, todayKey);
  const rows = sorted.slice(0, limit).map((i): DeadlineRow => ({
    ...i,
    tag: deadlineTag(i.dayKey, todayKey),
    tone: warn?.key === i.key ? "warn" : daysBetweenKeys(todayKey, i.dayKey) < 7 ? "soon" : "later",
  }));
  // The warned one stays in the list even past the first few.
  if (warn && !rows.some((r) => r.key === warn.key)) {
    rows[rows.length - 1] = { ...warn, tag: deadlineTag(warn.dayKey, todayKey), tone: "warn" };
    rows.sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  }
  return { rows, total: items.length, insight: warn ? warningText(warn, todayKey) : null };
}
