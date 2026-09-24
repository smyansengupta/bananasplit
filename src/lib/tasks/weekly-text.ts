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
  if (kind === "next" && item.dueKey) return `${item.title}${parent} (due ${formatDueKey(item.dueKey, todayKey)})`;
  return `${item.title}${parent}`;
}

export function summaryLines(summary: WeeklySummary, todayKey: string): WeeklyLines {
  return {
    done: summary.done.map((i) => itemLine(i, todayKey, "done")),
    next: summary.next.map((i) => itemLine(i, todayKey, "next")),
    blocked: summary.blocked.map((i) => itemLine(i, todayKey, "blocked")),
  };
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
