/**
 * A task linked to a CRM person, company or deal (an ItemLink, from the
 * task's Linked panel or Make it a task) is that record's next step while
 * it's open: its due date is when, its title is what. Completing or
 * trashing the task clears it. Pure; src/server/crm/task-steps.ts reads
 * the links and tasks as the viewer.
 */

export interface TaskStep {
  taskId: string;
  title: string;
  /** The task's due date as a date key ("2026-11-03"), or null for none. */
  dueKey: string | null;
}

export interface LinkedTaskRow {
  id: string;
  title: string;
  status: string;
  /** Tasks store due dates as UTC midnight (src/lib/tasks/dates.ts). */
  dueDate: Date | null;
  completedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

/** An open task: not done and not in the trash. */
export function isOpenTask(t: Pick<LinkedTaskRow, "status" | "completedAt" | "deletedAt">): boolean {
  return t.status !== "COMPLETED" && !t.completedAt && !t.deletedAt;
}

/**
 * The step among a record's linked tasks: the open one due soonest; with
 * none dated, the newest open one. Null when every task is done.
 */
export function pickTaskStep(tasks: readonly LinkedTaskRow[]): TaskStep | null {
  const open = tasks.filter(isOpenTask);
  if (!open.length) return null;
  const best = [...open].sort((a, b) => {
    if (a.dueDate && b.dueDate) return a.dueDate.getTime() - b.dueDate.getTime();
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0]!;
  return {
    taskId: best.id,
    title: best.title,
    dueKey: best.dueDate ? best.dueDate.toISOString().slice(0, 10) : null,
  };
}

const MAX_TITLE = 60;

function shortKey(key: string): string {
  return new Date(`${key}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function daysBetweenKeys(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

/** "Send the deck, Nov 12", "Send the deck, today", "Send the deck, 3 days late", or just the title. */
export function taskStepText(step: TaskStep, todayKey: string): string {
  const title =
    step.title.length > MAX_TITLE ? `${step.title.slice(0, MAX_TITLE - 1).trimEnd()}…` : step.title;
  if (!step.dueKey) return title;
  const late = daysBetweenKeys(step.dueKey, todayKey);
  if (late === 0) return `${title}, today`;
  if (late === 1) return `${title}, a day late`;
  if (late > 1) return `${title}, ${late} days late`;
  return `${title}, ${shortKey(step.dueKey)}`;
}
