import type { TaskStatus } from "@/generated/prisma/enums";
import { addDaysToKey, daysBetweenKeys } from "@/lib/tasks/dates";
import { dayWordOfKey } from "@/lib/overview/format";

/**
 * "Who owns what" on the Overview: an event's work, piece by piece, and who
 * has each piece. The pieces come from the tasks linked to the event: when
 * two or more of them share an epic, the epics are the pieces; otherwise
 * when two or more share a tag, the tags are; otherwise each task is its own
 * piece. A task outside every group stays a piece of its own.
 *
 * A piece's state is the loudest of its tasks': done when all of them are,
 * then blocked, then late, then the soonest due date, then in progress.
 * A piece with an open task nobody owns is an empty seat.
 *
 * Pure: tasks and today in, rows out.
 */

export interface OwnerFace {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
}

export interface OwnTask {
  id: string;
  title: string;
  status: TaskStatus;
  dueKey: string | null;
  blockedReason: string | null;
  owner: OwnerFace | null;
  epic: { id: string; title: string } | null;
  labels: readonly { id: string; name: string }[];
}

export type PieceTone = "done" | "blocked" | "late" | "soon" | "open" | "seat";

export interface Piece {
  key: string;
  title: string;
  href: string;
  /** Distinct owners of its tasks, the one with the most first. */
  owners: OwnerFace[];
  /** Open tasks nobody owns (the Assign button gives them an owner). */
  unownedTaskIds: string[];
  taskCount: number;
  state: { word: string; tone: PieceTone };
  /** Why it's blocked, when one of its tasks says. */
  blockedReason: string | null;
}

export type GroupedBy = "epic" | "label" | "task";

const isDone = (t: OwnTask) => t.status === "COMPLETED";

function stateOf(tasks: readonly OwnTask[], todayKey: string): Piece["state"] {
  const open = tasks.filter((t) => !isDone(t));
  if (open.length === 0) return { word: "Done", tone: "done" };
  if (open.some((t) => t.status === "BLOCKED")) return { word: "Blocked", tone: "blocked" };
  const dues = open.flatMap((t) => (t.dueKey ? [t.dueKey] : [])).sort();
  const first = dues[0];
  if (first && first < todayKey) return { word: "Late", tone: "late" };
  if (open.some((t) => !t.owner)) return { word: "Open", tone: "seat" };
  if (first && first <= addDaysToKey(todayKey, 6)) {
    const word = dayWordOfKey(first, todayKey);
    return {
      word: `Due ${daysBetweenKeys(todayKey, first) <= 1 ? word.toLowerCase() : word}`,
      tone: "soon",
    };
  }
  if (open.some((t) => t.status === "IN_PROGRESS")) return { word: "In progress", tone: "open" };
  return { word: "Not started", tone: "open" };
}

function ownersOf(tasks: readonly OwnTask[]): OwnerFace[] {
  const count = new Map<string, { face: OwnerFace; n: number }>();
  for (const t of tasks) {
    if (!t.owner) continue;
    const hit = count.get(t.owner.id);
    if (hit) hit.n += 1;
    else count.set(t.owner.id, { face: t.owner, n: 1 });
  }
  return [...count.values()].sort((a, b) => b.n - a.n).map((x) => x.face);
}

/** The key two or more tasks share, by the rule above, or null when none do. */
function groupingOf(tasks: readonly OwnTask[]): GroupedBy {
  const shared = (keys: string[]) => {
    const seen = new Map<string, number>();
    for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
    return [...seen.values()].some((n) => n >= 2);
  };
  if (shared(tasks.flatMap((t) => (t.epic ? [t.epic.id] : [])))) return "epic";
  if (shared(tasks.flatMap((t) => t.labels.map((l) => l.id)))) return "label";
  return "task";
}

export function buildPieces(
  tasks: readonly OwnTask[],
  { base, todayKey }: { base: string; todayKey: string },
): { groupedBy: GroupedBy; pieces: Piece[] } {
  const groupedBy = groupingOf(tasks);
  const groups = new Map<string, { title: string; href: string; tasks: OwnTask[] }>();
  const put = (key: string, title: string, href: string, task: OwnTask) => {
    const g = groups.get(key);
    if (g) g.tasks.push(task);
    else groups.set(key, { title, href, tasks: [task] });
  };
  for (const t of tasks) {
    if (groupedBy === "epic" && t.epic) {
      put(`epic:${t.epic.id}`, t.epic.title, `${base}/tasks/${t.epic.id}`, t);
    } else if (groupedBy === "label" && t.labels.length > 0) {
      // A task with several tags sits under its first.
      const label = t.labels[0]!;
      put(`label:${label.id}`, label.name, `${base}/tasks?view=list&label=${label.id}`, t);
    } else {
      put(`task:${t.id}`, t.title, `${base}/tasks/${t.id}`, t);
    }
  }
  const pieces = [...groups.entries()].map(([key, g]): Piece => {
    const state = stateOf(g.tasks, todayKey);
    return {
      key,
      title: g.title,
      href: g.tasks.length === 1 ? `${base}/tasks/${g.tasks[0]!.id}` : g.href,
      owners: ownersOf(g.tasks),
      unownedTaskIds: g.tasks.filter((t) => !t.owner && !isDone(t)).map((t) => t.id),
      taskCount: g.tasks.length,
      state,
      blockedReason:
        g.tasks.find((t) => t.status === "BLOCKED" && t.blockedReason)?.blockedReason ?? null,
    };
  });
  // Empty seats and trouble first, done last; otherwise as they came.
  const rank: Record<PieceTone, number> = {
    seat: 0,
    blocked: 1,
    late: 2,
    soon: 3,
    open: 4,
    done: 5,
  };
  const order = (p: Piece) =>
    p.unownedTaskIds.length > 0 && p.owners.length === 0 ? -1 : rank[p.state.tone];
  return { groupedBy, pieces: pieces.sort((a, b) => order(a) - order(b)) };
}

/** "Music", "Music and Cleanup", "Music, Food and Cleanup". */
export function andList(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
