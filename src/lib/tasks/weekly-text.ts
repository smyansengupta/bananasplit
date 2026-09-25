import { formatDueKey } from "./dates";

/**
 * The Sunday update as text: the lines stored in WeeklyUpdate and the
 * 'Copy as text' output. Pure and client-safe.
 */

export interface WeeklyItem {
  id: string;
  title: string;
  status: string;
  dueKey: string | null;
  blockedReason: string | null;
  role: "owner" | "collaborator";
  parentTitle: string | null;
  /**
   * C4: a private task. It appears in your own draft — it is your week —
   * but posting publishes the lines to the whole org, so private items are
   * dropped from what is posted and the composer says so.
   */
  isPrivate?: boolean;
}

export interface WeeklySummary {
  weekStart: string;
  done: WeeklyItem[];
  next: WeeklyItem[];
  blocked: WeeklyItem[];
}

export interface WeeklyLines {
  done: string[];
  next: string[];
  blocked: string[];
}

function itemLine(item: WeeklyItem, todayKey: string, kind: keyof WeeklyLines): string {
  const parent = item.parentTitle ? ` (${item.parentTitle})` : "";
  if (kind === "blocked") return `${item.title}${parent}: ${item.blockedReason ?? "blocked"}`;
  if (kind === "next" && item.dueKey)
    return `${item.title}${parent} (due ${formatDueKey(item.dueKey, todayKey)})`;
  return `${item.title}${parent}`;
}

/**
 * The lines that get published. Private tasks are left out: a posted update
 * is readable by the whole organization, and a title that was deliberately
 * kept off the open board must not arrive there through the Sunday post.
 */
export function summaryLines(summary: WeeklySummary, todayKey: string): WeeklyLines {
  const shared = (items: WeeklyItem[]) => items.filter((i) => !i.isPrivate);
  return {
    done: shared(summary.done).map((i) => itemLine(i, todayKey, "done")),
    next: shared(summary.next).map((i) => itemLine(i, todayKey, "next")),
    blocked: shared(summary.blocked).map((i) => itemLine(i, todayKey, "blocked")),
  };
}

/** How many of the week's items are being held back because they are private. */
export function privateItemCount(summary: WeeklySummary): number {
  return [...summary.done, ...summary.next, ...summary.blocked].filter((i) => i.isPrivate).length;
}

/** The plain-text update for 'Copy as text'. */
export function formatWeeklyText(input: {
  personName: string;
  weekStart: string;
  lines: WeeklyLines;
  note?: string | null;
}): string {
  const section = (title: string, lines: string[]) =>
    `${title}\n${lines.length > 0 ? lines.map((l) => `- ${l}`).join("\n") : "- Nothing"}`;
  const parts = [
    `Sunday update: ${input.personName}, week of ${formatDueKey(input.weekStart)}`,
    section("Done", input.lines.done),
    section("Next", input.lines.next),
    section("Blocked", input.lines.blocked),
  ];
  if (input.note?.trim()) parts.push(`Note\n${input.note.trim()}`);
  return parts.join("\n\n");
}
