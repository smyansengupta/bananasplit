import { addDaysToKey, daysBetweenKeys, dueDateKey, weekdayOfKey } from "@/lib/tasks/dates";
import { rollUp } from "@/lib/tasks/hierarchy";

/**
 * When a task's ambient buttons show (Buttons2: Tasks, epics and projects).
 * Each rule is a plain function of the task and today, so the row, the task
 * page, the board and the Epics timeline all agree. The UI maps each kind to
 * its button and shows the first two.
 */

const DAY_MS = 86_400_000;
/** Blocked this long, the row asks someone to unblock it. */
export const BLOCKED_DAYS = 2;
/** Untouched this long, the row asks if it's still needed. */
export const STALE_DAYS = 14;
/** Waiting on someone and quiet this long, the task page offers Follow up. */
const QUIET_DAYS = 5;
/** Due this soon (not late yet), the task page offers Follow up. */
const SOON_DAYS = 2;

export type TaskAmbientKind =
  | "close-epic"
  | "mark-done"
  | "push"
  | "nudge"
  | "unblock"
  | "take"
  | "assign"
  | "follow-up"
  | "still-needed";

export interface TaskAmbient {
  kind: TaskAmbientKind;
  /** Why it's here, in a few words. */
  reason: string;
  /** Nudge, Follow up and Ask to unblock: whom the comment mentions. */
  personId?: string;
}

export interface TaskAmbientInput {
  type: "EPIC" | "STORY" | "TASK";
  status: string;
  dueDate: Date | string | null;
  ownerId: string | null;
  owner?: { name: string | null } | null;
  createdById: string;
  createdBy?: { name: string | null } | null;
  blockedAt: Date | string | null;
  blockedReason: string | null;
  subtasks: readonly { status: string; subtasks?: readonly { status: string }[] }[];
  /** Its last change (updatedAt); the made date when it has none. */
  updatedAt?: Date | string | null;
  createdAt: Date | string;
}

export interface TaskAmbientContext {
  viewerId: string;
  todayKey: string;
  now: Date;
  /** The viewer may edit it (canEditTask). */
  editable: boolean;
  /** The task page: Follow up shows there (and on Home), not on rows. */
  page?: boolean;
}

function firstName(person: { name: string | null } | null | undefined): string {
  return person?.name?.trim().split(/\s+/)[0] || "them";
}

function at(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function keyOf(value: Date | string): string {
  return dueDateKey(at(value));
}

/** Whole days late (0 when it isn't). */
export function daysLate(dueDate: Date | string | null, todayKey: string): number {
  if (!dueDate) return 0;
  return Math.max(0, daysBetweenKeys(keyOf(dueDate), todayKey));
}

/** "1 day", "4 days". */
export function dayWords(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

function wholeDaysSince(value: Date | string, now: Date): number {
  return Math.floor((now.getTime() - at(value).getTime()) / DAY_MS);
}

/** The Monday after today (a week on when today is Monday). */
export function nextMondayKey(todayKey: string): string {
  const dow = weekdayOfKey(todayKey);
  return addDaysToKey(todayKey, (8 - dow) % 7 || 7);
}

/** What a task's ambient buttons are right now, most useful first. */
export function taskAmbient(task: TaskAmbientInput, ctx: TaskAmbientContext): TaskAmbient[] {
  if (task.status === "COMPLETED") return [];
  const out: TaskAmbient[] = [];
  const me = ctx.viewerId;
  const late = task.type === "EPIC" ? 0 : daysLate(task.dueDate, ctx.todayKey);
  const progress = rollUp(task.subtasks);
  const allDone = progress.total > 0 && progress.done === progress.total;

  // Finishing it beats everything else.
  if (allDone && ctx.editable) {
    out.push(
      task.type === "EPIC"
        ? { kind: "close-epic", reason: "Every task in it is done" }
        : {
            kind: "mark-done",
            reason: `${progress.done} of ${progress.total} subtasks done`,
          },
    );
  }

  if (late > 0 && task.ownerId === me && ctx.editable) {
    out.push({ kind: "push", reason: `Yours, ${dayWords(late)} late` });
  }
  if (late > 0 && task.ownerId && task.ownerId !== me) {
    out.push({
      kind: "nudge",
      reason: `${firstName(task.owner)}, ${dayWords(late)} late`,
      personId: task.ownerId,
    });
  }

  if (task.status === "BLOCKED" && task.blockedAt) {
    const days = wholeDaysSince(task.blockedAt, ctx.now);
    // The owner is asked; an owner who is asking asks whoever made it.
    const ask =
      task.ownerId && task.ownerId !== me
        ? { id: task.ownerId, person: task.owner }
        : task.createdById !== me
          ? { id: task.createdById, person: task.createdBy }
          : null;
    if (days >= BLOCKED_DAYS && ask) {
      const on = task.blockedReason?.trim();
      out.push({
        kind: "unblock",
        reason: `Blocked ${dayWords(days)}${on ? `: ${on.length > 40 ? `${on.slice(0, 39)}…` : on}` : ""}`,
        personId: ask.id,
      });
    }
  }

  if (!task.ownerId && task.type !== "EPIC") {
    out.push({ kind: "take", reason: "No owner" });
    if (ctx.editable) out.push({ kind: "assign", reason: "No owner" });
  }

  if (ctx.page && late === 0 && task.ownerId && task.ownerId !== me && task.createdById === me) {
    const due = task.dueDate ? daysBetweenKeys(ctx.todayKey, keyOf(task.dueDate)) : null;
    const quiet = wholeDaysSince(task.updatedAt ?? task.createdAt, ctx.now);
    const who = firstName(task.owner);
    if (due !== null && due <= SOON_DAYS) {
      out.push({
        kind: "follow-up",
        reason: `Waiting on ${who}, due ${due === 0 ? "today" : due === 1 ? "tomorrow" : `in ${due} days`}`,
        personId: task.ownerId,
      });
    } else if (quiet >= QUIET_DAYS) {
      out.push({
        kind: "follow-up",
        reason: `Waiting on ${who}, quiet for ${dayWords(quiet)}`,
        personId: task.ownerId,
      });
    }
  }

  if (ctx.editable && task.type !== "EPIC" && !allDone) {
    const quiet = wholeDaysSince(task.updatedAt ?? task.createdAt, ctx.now);
    if (quiet >= STALE_DAYS) {
      out.push({ kind: "still-needed", reason: `No activity for ${dayWords(quiet)}` });
    }
  }

  return out;
}

/** An epic on the timeline whose every task is done, still open: Close the epic. */
export function epicReadyToClose(e: { status: string; done: number; total: number }): boolean {
  return e.status !== "COMPLETED" && e.total > 0 && e.done === e.total;
}

/** Selected tasks that are late and the viewer may move: Push all to Monday's work. */
export function lateSelection<
  T extends { id: string; type: string; status: string; dueDate: Date | string | null },
>(
  tasks: readonly T[],
  selected: ReadonlySet<string>,
  todayKey: string,
  editable: (t: T) => boolean,
) {
  return tasks.filter(
    (t) =>
      selected.has(t.id) &&
      t.type !== "EPIC" &&
      t.status !== "COMPLETED" &&
      daysLate(t.dueDate, todayKey) > 0 &&
      editable(t),
  );
}

/** Push all to Monday shows for two or more. */
export const PUSH_ALL_MIN = 2;

export interface AgendaMeeting {
  id: string;
  title: string;
  startsAt: Date | string;
  description: string | null;
}

/**
 * The meeting this task is linked to that's coming up this week (the next
 * seven days) and doesn't have it on its agenda yet: Add to agenda.
 */
export function agendaMeetingFor(
  taskId: string,
  meetings: readonly AgendaMeeting[],
  now: Date,
): AgendaMeeting | null {
  const end = now.getTime() + 7 * DAY_MS;
  const upcoming = meetings
    .filter((m) => {
      const t = at(m.startsAt).getTime();
      return t >= now.getTime() && t <= end;
    })
    .filter((m) => !(m.description ?? "").includes(`/tasks/${taskId}`))
    .sort((a, b) => at(a.startsAt).getTime() - at(b.startsAt).getTime());
  return upcoming[0] ?? null;
}

/** The agenda with a line linking the task (the agenda's own @ link format). */
export function agendaWithTask(
  description: string | null,
  task: { id: string; title: string },
  orgSlug: string,
): string {
  const title =
    task.title
      .replace(/[[\]()\n\r]/g, "")
      .trim()
      .slice(0, 120) || "Task";
  const line = `- [${title}](/app/${orgSlug}/tasks/${task.id})`;
  const before = (description ?? "").trimEnd();
  return before ? `${before}\n${line}` : line;
}
