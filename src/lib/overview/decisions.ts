import type { ItemRef } from "@/lib/overview/types";
import { dayWordOfKey } from "@/lib/overview/format";
import {
  daysBetweenKeys,
  formatDueKey,
  localDateKey,
  WEEKDAY_NAMES,
  weekdayOfKey,
} from "@/lib/tasks/dates";

/**
 * The Decisions widget's words: each open decision's state line ("7 of 12
 * voted. Decide by Mon.", "Raised twice. Nobody owns it."), the one action
 * its row offers, and the widget's one finding. Pure and client-safe.
 */

export interface DecisionFace {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
}

/** A chip on the row: the meeting, note, poll or event it came from. */
export type DecisionLink = ItemRef;

export interface DecisionPoll {
  id: string;
  title: string;
  href: string;
  /** How many have voted, and how many may. */
  voted: number;
  eligible: number;
  /** The viewer has voted. */
  mine: boolean;
  /** Still taking votes. */
  open: boolean;
  /** ISO instant. */
  closesAt: string | null;
  options: { label: string; votes: number; pct: number }[];
}

/** The next meeting it could go on: a linked meeting still ahead, or the next one in its series. */
export interface AgendaSlot {
  eventId: string;
  title: string;
  href: string;
  /** The meeting's day, "YYYY-MM-DD", in the viewer's zone. */
  dayKey: string;
  /** Its agenda (the meeting's description) as it stands, to add a line to. */
  agenda: string;
  /** The question is already written in it. */
  onAgenda: boolean;
}

export interface DecisionRow {
  id: string;
  question: string;
  detail: string | null;
  owner: DecisionFace | null;
  /** Who raised it (with the owner, who may settle it); null once they've left. */
  createdById: string | null;
  /** ISO instants (plain data for the client). */
  createdAt: string;
  dueAt: string | null;
  links: DecisionLink[];
  poll: DecisionPoll | null;
  agenda: AgendaSlot | null;
}

export type DecisionAction = "vote" | "take" | "agenda" | null;

/** Links to meetings: each one is a time it came up. */
function timesRaised(links: readonly DecisionLink[]): number {
  return new Set(links.filter((l) => l.kind === "meeting").map((l) => l.href)).size;
}

/**
 * The one thing the row asks of you: vote on its poll, take it, or put it
 * on an agenda (only for someone who may edit the meeting: `canAgenda`).
 */
export function decisionAction(d: DecisionRow, { canAgenda = true } = {}): DecisionAction {
  if (d.poll?.open && !d.poll.mine) return "vote";
  if (!d.owner) return "take";
  if (canAgenda && d.agenda && !d.agenda.onAgenda) return "agenda";
  return null;
}

/** "Monday's agenda", "today's agenda", "the Nov 12 agenda". */
function agendaWord(dayKey: string, todayKey: string): string {
  const days = daysBetweenKeys(todayKey, dayKey);
  if (days === 0) return "today's agenda";
  if (days === 1) return "tomorrow's agenda";
  if (days > 1 && days < 7) return `${WEEKDAY_NAMES[weekdayOfKey(dayKey)]}'s agenda`;
  return `the ${formatDueKey(dayKey, todayKey).replace(/^\w+, /, "")} agenda`;
}

/** "today", "tomorrow", "Mon", "Wed, Oct 21": a day mid-sentence. */
function dayInSentence(key: string, todayKey: string): string {
  const word = dayWordOfKey(key, todayKey);
  return word === "Today" || word === "Tomorrow" ? word.toLowerCase() : word;
}

const firstName = (face: DecisionFace) => face.name?.trim().split(/\s+/)[0] ?? "Someone";

/** The row's state, in a sentence or three. */
export function decisionLine(
  d: DecisionRow,
  {
    todayKey,
    timeZone,
    viewerId,
    canAgenda = true,
  }: { todayKey: string; timeZone: string; viewerId: string; canAgenda?: boolean },
): string {
  const parts: string[] = [];
  if (d.poll) {
    parts.push(
      d.poll.eligible > 0
        ? `${d.poll.voted} of ${d.poll.eligible} voted.`
        : `${d.poll.voted} ${d.poll.voted === 1 ? "vote" : "votes"} so far.`,
    );
    if (!d.poll.open) parts.push("Voting closed.");
    else if (d.poll.closesAt) {
      parts.push(
        `Closes ${dayInSentence(localDateKey(new Date(d.poll.closesAt), timeZone), todayKey)}.`,
      );
    }
  }
  const raised = timesRaised(d.links);
  if (raised >= 2) parts.push(raised === 2 ? "Raised twice." : `Raised ${raised} times.`);
  if (!d.owner) parts.push("Nobody owns it.");
  else if (!d.poll)
    parts.push(d.owner.id === viewerId ? "Yours." : `${firstName(d.owner)} owns it.`);
  if (d.dueAt) {
    const key = localDateKey(new Date(d.dueAt), timeZone);
    parts.push(
      key < todayKey
        ? `Was due ${dayInSentence(key, todayKey)}.`
        : `Decide by ${dayInSentence(key, todayKey)}.`,
    );
  }
  if (decisionAction(d, { canAgenda }) === "agenda" && d.agenda) {
    parts.push(`Put it on ${agendaWord(d.agenda.dayKey, todayKey)}?`);
  } else if (d.agenda?.onAgenda) {
    parts.push(`On ${agendaWord(d.agenda.dayKey, todayKey)}.`);
  }
  return parts.join(" ");
}

export type DecisionsFinding =
  { kind: "overdue"; titles: string[] } | { kind: "unowned"; count: number } | null;

/**
 * The widget's one finding, when there is one: decisions past their date,
 * else two or more that nobody owns.
 */
export function decisionsFinding(
  rows: readonly DecisionRow[],
  { todayKey, timeZone }: { todayKey: string; timeZone: string },
): DecisionsFinding {
  const overdue = rows.filter(
    (d) => d.dueAt && localDateKey(new Date(d.dueAt), timeZone) < todayKey,
  );
  if (overdue.length > 0) return { kind: "overdue", titles: overdue.map((d) => d.question) };
  const unowned = rows.filter((d) => !d.owner).length;
  if (unowned >= 2) return { kind: "unowned", count: unowned };
  return null;
}

/** The id in a meeting or event link ("/app/x/meetings/abc" is abc). */
export function eventIdOfHref(href: string): string | null {
  const m = /\/(?:meetings|calendar)\/([A-Za-z0-9_-]{1,64})(?:$|[?#])/.exec(href);
  return m ? m[1]! : null;
}

/** The agenda with the question added as its last line. */
export function withAgendaLine(agenda: string, question: string): string {
  const line = `- ${question.trim()}`;
  const body = agenda.replace(/\s+$/, "");
  return body ? `${body}\n${line}` : line;
}
