/**
 * When a meeting's ambient buttons show (Buttons2: Meetings), and what its
 * notes hold that a button can act on: to-dos not yet tasks, decisions not
 * yet logged. Plain functions, so the page and the server actions agree on
 * the same lines.
 */

const MINUTE_MS = 60_000;
/** Join and Take notes show this long before it starts. */
export const STARTING_SOON_MINUTES = 15;
/** The meeting template's placeholder action item. */
const PLACEHOLDER_TODO = /^owner:\s*task,\s*by date$/i;

export type MeetingAmbientKind = "draft-agenda" | "join" | "take-notes";

export interface MeetingAmbient {
  kind: MeetingAmbientKind;
  reason: string;
}

export interface MeetingAmbientInput {
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  canEdit: boolean;
  agenda: string | null;
  /** Open tasks and decisions an agenda could be drafted from. */
  openItems: number;
  joinUrl: string | null;
}

function dayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Starting within 15 minutes (or just started), Join and Take notes. */
export function startingSoon(m: { startsAt: Date; endsAt: Date }, now: Date): boolean {
  const t = now.getTime();
  return t >= m.startsAt.getTime() - STARTING_SOON_MINUTES * MINUTE_MS && t < m.endsAt.getTime();
}

/** Under way: Add an action item beside the notes. */
export function underWay(m: { startsAt: Date; endsAt: Date }, now: Date): boolean {
  return now >= m.startsAt && now < m.endsAt;
}

/** The meeting's own ambient buttons (its header), most useful first. */
export function meetingAmbient(m: MeetingAmbientInput, now: Date): MeetingAmbient[] {
  const out: MeetingAmbient[] = [];
  if (startingSoon(m, now)) {
    const mins = Math.ceil((m.startsAt.getTime() - now.getTime()) / MINUTE_MS);
    const reason =
      mins > 0 ? `Starts in ${mins === 1 ? "a minute" : `${mins} minutes`}` : "It's started";
    if (m.joinUrl) out.push({ kind: "join", reason });
    out.push({ kind: "take-notes", reason });
  }
  const tomorrow = dayKey(new Date(now.getTime() + 24 * 60 * MINUTE_MS), m.timeZone);
  if (
    m.canEdit &&
    !m.agenda?.trim() &&
    m.openItems > 0 &&
    dayKey(m.startsAt, m.timeZone) === tomorrow
  ) {
    out.push({
      kind: "draft-agenda",
      reason: `Tomorrow, no agenda yet, ${m.openItems} open ${m.openItems === 1 ? "item" : "items"}`,
    });
  }
  return out;
}

// ---- What the notes say ---------------------------------------------------------------

interface DocNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
}

function textOf(node: DocNode): string {
  if (node.type === "text") return node.text ?? "";
  // A nested list inside an item is its own item, not part of this one's text.
  return (node.content ?? [])
    .filter((c) => c.type !== "taskList" && c.type !== "bulletList" && c.type !== "orderedList")
    .map(textOf)
    .join(node.type === "paragraph" ? "" : " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NoteTodo {
  /** The task's title. */
  title: string;
  /** "Lucas" in "Lucas: confirm the speaker": who it's for, as written. */
  ownerName: string | null;
}

const TODO_HEADING = /^(action items?|to ?-?dos?|next steps|follow ?-?ups?)$/i;
const DECISION_HEADING = /^decisions?( made)?$/i;
const DECISION_LINE = /^(?:decided|decision|we decided|agreed)\s*[:-]\s*(.+)$/i;
const OWNER_PREFIX = /^([A-Z][\p{L}'-]{1,30}(?: [A-Z][\p{L}'-]{1,30})?)\s*:\s*(.+)$/u;

/** "Lucas: confirm the speaker" as its owner and title; other lines as they are. */
export function splitTodo(line: string): NoteTodo {
  const m = OWNER_PREFIX.exec(line.trim());
  if (!m) return { title: line.trim(), ownerName: null };
  const title = m[2]!.trim();
  return { title: title.charAt(0).toUpperCase() + title.slice(1), ownerName: m[1]! };
}

/**
 * The open to-dos and the decisions in a note's document (contentJson): an
 * unticked checklist item anywhere, a list item under an "Action items" or
 * "To do" heading, a list item under "Decisions", and a line starting
 * "Decided:". The meeting template's placeholder and empty lines are left out.
 */
export function noteItems(doc: unknown): { todos: NoteTodo[]; decisions: string[] } {
  const todos: NoteTodo[] = [];
  const decisions: string[] = [];
  let heading = "";
  const walk = (node: DocNode, inList: boolean) => {
    if (node.type === "heading") {
      heading = textOf(node);
      return;
    }
    if (node.type === "taskItem") {
      const text = textOf(node);
      if (node.attrs?.checked !== true && text && !PLACEHOLDER_TODO.test(text)) {
        todos.push(splitTodo(text));
      }
    } else if (node.type === "listItem") {
      const text = textOf(node);
      if (text) {
        if (TODO_HEADING.test(heading) && !PLACEHOLDER_TODO.test(text)) todos.push(splitTodo(text));
        else if (DECISION_HEADING.test(heading)) decisions.push(text);
        else {
          const m = DECISION_LINE.exec(text);
          if (m) decisions.push(m[1]!.trim());
        }
      }
    } else if (node.type === "paragraph" && !inList) {
      const m = DECISION_LINE.exec(textOf(node));
      if (m) decisions.push(m[1]!.trim());
    }
    const list = inList || node.type === "listItem" || node.type === "taskItem";
    for (const child of node.content ?? []) walk(child, list);
  };
  if (doc && typeof doc === "object") walk(doc as DocNode, false);
  return { todos: dedupe(todos, (t) => t.title), decisions: dedupe(decisions, (d) => d) };
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = normal(key(item));
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Lowercased words only, for "is this already a task". */
export function normal(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The to-dos that aren't one of the meeting's tasks yet. */
export function todosWithoutTasks(
  todos: readonly NoteTodo[],
  taskTitles: readonly string[],
): NoteTodo[] {
  const have = new Set(taskTitles.map(normal));
  return todos.filter((t) => !have.has(normal(t.title)));
}

/** The decisions not yet logged (as a decision linked to the meeting). */
export function decisionsToLog(
  decisions: readonly string[],
  logged: readonly { question: string; outcome: string | null }[],
): string[] {
  const have = new Set(logged.flatMap((d) => [normal(d.question), normal(d.outcome ?? "")]));
  return decisions.filter((d) => !have.has(normal(d)));
}

/** "Turn 3 to-dos into tasks". */
export function todoLabel(n: number): string {
  return n === 1 ? "Turn 1 to-do into a task" : `Turn ${n} to-dos into tasks`;
}

/**
 * Who a to-do is for: the one member whose first name (or whole name) it
 * names. Null when nobody, or more than one, matches.
 */
export function matchOwner(
  ownerName: string | null,
  members: readonly { id: string; name: string | null }[],
): string | null {
  if (!ownerName) return null;
  const want = normal(ownerName);
  const whole = members.filter((m) => normal(m.name ?? "") === want);
  if (whole.length === 1) return whole[0]!.id;
  const first = members.filter((m) => normal(m.name ?? "").split(" ")[0] === want);
  return first.length === 1 ? first[0]!.id : null;
}

/** Maybes on a meeting still to come: Remind maybes. */
export function undecidedMaybes(
  attendees: readonly { rsvp: string }[],
  m: { startsAt: Date; canEdit: boolean },
  now: Date,
): number {
  if (!m.canEdit || m.startsAt <= now) return 0;
  return attendees.filter((a) => a.rsvp === "MAYBE").length;
}

/** The agenda drafted from open items: one linked line each. */
export function draftAgenda(items: readonly { title: string; href: string }[]): string {
  return items
    .map((i) => {
      const title =
        i.title
          .replace(/[[\]()\n\r]/g, "")
          .trim()
          .slice(0, 120) || "Item";
      return `- [${title}](${i.href})`;
    })
    .join("\n");
}
