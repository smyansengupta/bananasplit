import { dayWordOfKey } from "@/lib/overview/format";
import type { ItemRef, PersonFace } from "@/lib/overview/types";

import { daysAgoWord, daysSince, firstName, plural } from "./text";

/**
 * Waiting on others: what the viewer asked other people for (tasks they
 * made and handed to someone, mentions nobody answered), with how long
 * it's been and whether the other person has moved on it since, and the
 * one ask most worth chasing. Pure; the loader gathers OthersFacts.
 */

export interface OthersAsk {
  kind: "task" | "mention";
  /** The task, or the mention row. */
  id: string;
  taskId: string;
  title: string;
  person: PersonFace;
  askedAt: Date;
  dueKey: string | null;
  /** They changed the task or commented on it after the ask. */
  movedSince: boolean;
  epic: { id: string; title: string } | null;
  event: { id: string; title: string } | null;
}

export interface OthersFacts {
  base: string;
  todayKey: string;
  now: Date;
  asks: OthersAsk[];
}

export type OthersState = "on-track" | "overdue" | "waiting";

export interface OthersRow {
  key: string;
  kind: OthersAsk["kind"];
  taskId: string;
  person: PersonFace;
  title: string;
  sub: string;
  href: string;
  state: OthersState;
  /** What the task is for: its event, else its epic. */
  chips: ItemRef[];
}

export interface WaitingOnOthers {
  rows: OthersRow[];
  insight: { text: string; tone: "plain" | "warn" } | null;
}

export function stateOf(ask: OthersAsk, todayKey: string): OthersState {
  if (ask.kind === "task" && ask.dueKey && ask.dueKey < todayKey) return "overdue";
  return ask.movedSince ? "on-track" : "waiting";
}

export function buildWaitingOnOthers(f: OthersFacts): WaitingOnOthers {
  const rows = f.asks.map((a): OthersRow => {
    const who = firstName(a.person.name);
    const ago = daysAgoWord(a.askedAt, f.now);
    const where = a.epic ? ` in ${a.epic.title}` : a.event ? ` for ${a.event.title}` : "";
    const state = stateOf(a, f.todayKey);
    const due = a.dueKey ? `, due ${dayWordOfKey(a.dueKey, f.todayKey)}` : "";
    const moved = a.movedSince ? ` ${who} has updated it since.` : " No reply yet.";
    return {
      key: `${a.kind}:${a.id}`,
      kind: a.kind,
      taskId: a.taskId,
      person: a.person,
      title: a.kind === "task" ? `${a.title} from ${who}` : `Reply from ${who} on ${a.title}`,
      sub:
        a.kind === "task"
          ? `Assigned ${ago}${where}${due}.${moved}`
          : `You mentioned ${who} ${ago}.${moved}`,
      href: `${f.base}/tasks/${a.taskId}`,
      state,
      chips: a.event
        ? [{ kind: "event", label: a.event.title, href: `${f.base}/calendar/${a.event.id}` }]
        : a.epic
          ? [{ kind: "task", label: a.epic.title, href: `${f.base}/tasks/${a.epic.id}` }]
          : [],
    };
  });
  return { rows, insight: chaseInsight(f) };
}

/**
 * The ask to chase first: one past its due date, else the oldest with no
 * reply for three days or more; with what's waiting behind it when a link
 * says so. Null when nothing is late.
 */
export function chaseInsight(f: OthersFacts): { text: string; tone: "plain" | "warn" } | null {
  const late = f.asks.filter((a) => stateOf(a, f.todayKey) === "overdue");
  const quiet = f.asks
    .filter((a) => !a.movedSince && daysSince(a.askedAt, f.now) >= 3)
    .sort((a, b) => a.askedAt.getTime() - b.askedAt.getTime());
  const pick = late.sort((a, b) => (a.dueKey ?? "").localeCompare(b.dueKey ?? ""))[0] ?? quiet[0];
  if (!pick) return null;
  const who = firstName(pick.person.name);
  const why =
    pick.kind === "task" && pick.dueKey && pick.dueKey < f.todayKey
      ? `it was due ${dayWordOfKey(pick.dueKey, f.todayKey)}${pick.movedSince ? "" : ` and ${who} hasn't touched it`}`
      : `${plural(daysSince(pick.askedAt, f.now), "day")} without a reply from ${who}`;
  const behind = pick.event ? ` ${pick.event.title} waits on it.` : "";
  return { text: `${pick.title} is the one to chase: ${why}.${behind}`, tone: "warn" };
}
