import type { ItemRef, PersonFace } from "@/lib/overview/types";
import { dayWordOfKey } from "@/lib/overview/format";

import { firstName, listWords, money, plural } from "./text";

/**
 * Since you were here: what changed in the workspace since the viewer's
 * previous visit to Home, as rows grouped Assigned to you, Tasks, Notes,
 * People and Money, plus the one line that says where the activity was.
 * The loader gathers the changes (SinceFacts); everything that decides
 * and writes is here, pure, and unit tested.
 */

/** A visit inside this window is the same visit (a reload, a quick look back). */
export const SAME_VISIT_MS = 30 * 60 * 1000;

export interface VisitStamps {
  homeVisitAt: Date | null;
  homePrevVisitAt: Date | null;
}

/**
 * The stamps after a visit at `now`: a last visit more than half an hour
 * ago becomes the previous one, and this visit is the last.
 */
export function nextVisitStamps(current: VisitStamps | null, now: Date): VisitStamps {
  const last = current?.homeVisitAt ?? null;
  const prev = current?.homePrevVisitAt ?? null;
  if (last && now.getTime() - last.getTime() > SAME_VISIT_MS) {
    return { homeVisitAt: now, homePrevVisitAt: last };
  }
  return { homeVisitAt: now, homePrevVisitAt: prev };
}

/** What a change was about: an event or an epic (key "event:id" or "task:id"). */
export interface Subject {
  key: string;
  title: string;
}

interface TaskRef {
  taskId: string;
  title: string;
  subjects: Subject[];
  /** The event it's linked to, for its chip. */
  event: { id: string; title: string } | null;
}

export interface SinceFacts {
  base: string;
  todayKey: string;
  assigned: (TaskRef & {
    actor: PersonFace;
    dueKey: string | null;
    role: "owner" | "collaborator";
  })[];
  mentions: (TaskRef & { actor: PersonFace })[];
  finished: (TaskRef & { actor: PersonFace; epic: { id: string; title: string } | null })[];
  /** Comments others left on tasks the viewer owns or made. */
  comments: (TaskRef & { actor: PersonFace; count: number })[];
  notes: {
    noteId: string;
    title: string;
    actor: PersonFace;
    created: boolean;
    /**
     * Nobody edited it, only commented: `actor` is the first commenter and
     * `comments` counts every new comment, theirs too.
     */
    commentedOnly?: boolean;
    /** New comments on it since. */
    comments: number;
    /** The viewer wrote it. */
    mine: boolean;
    event: { id: string; title: string } | null;
  }[];
  joined: { people: PersonFace[]; goingTo: { id: string; title: string; count: number } | null };
  money: {
    id: string;
    description: string;
    amountCents: number;
    actor: PersonFace;
    change: "submitted" | "approved" | "paid" | "declined";
    mine: boolean;
    receipts: number;
    category: { id: string; name: string; periodId: string } | null;
    event: { id: string; title: string } | null;
  }[];
}

export type SinceGroup = "assigned" | "tasks" | "notes" | "people" | "money";

export const SINCE_GROUP_LABEL: Record<SinceGroup, string> = {
  assigned: "Assigned to you",
  tasks: "Tasks",
  notes: "Notes",
  people: "People",
  money: "Money",
};

export interface SinceRow {
  id: string;
  group: SinceGroup;
  /** Whose change it was; null shows `count` in the face's place. */
  face: PersonFace | null;
  /** One person joined: who, so the row can be dismissed. */
  newcomerId?: string;
  count?: number;
  title: string;
  sub: string | null;
  href: string;
  chips: ItemRef[];
  /** The "New" tag (work just handed to you). */
  isNew: boolean;
  /** Shown under "Only things for me". */
  forMe: boolean;
}

export interface SinceInsightRun {
  text: string;
  bold?: boolean;
}

export interface SinceYouWereHere {
  rows: SinceRow[];
  /** Every change counted (rows can stand for several). */
  total: number;
  insight: SinceInsightRun[] | null;
}

/** The busiest group's rows shown before "and N more" (the rest stay counted). */
const PER_GROUP = 4;

export function buildSince(f: SinceFacts): SinceYouWereHere {
  const rows: SinceRow[] = [];
  const subjects = new Map<string, { title: string; count: number }>();
  const count = (list: readonly Subject[], n = 1) => {
    for (const s of list) {
      const slot = subjects.get(s.key) ?? { title: s.title, count: 0 };
      slot.count += n;
      subjects.set(s.key, slot);
    }
  };
  let total = 0;
  const task = (t: { taskId: string; title: string }): ItemRef => ({
    kind: "task",
    label: t.title,
    href: `${f.base}/tasks/${t.taskId}`,
  });
  const event = (e: { id: string; title: string }): ItemRef => ({
    kind: "event",
    label: e.title,
    href: `${f.base}/meetings/${e.id}`,
  });

  for (const a of f.assigned) {
    total += 1;
    count(a.subjects);
    const due = a.dueKey ? `, due ${dayWordOfKey(a.dueKey, f.todayKey)}` : "";
    rows.push({
      id: `assigned:${a.taskId}`,
      group: "assigned",
      face: a.actor,
      title: a.title,
      sub: `${firstName(a.actor.name)} ${a.role === "owner" ? "gave it to you" : "added you"}${due}`,
      href: `${f.base}/tasks/${a.taskId}`,
      chips: a.event ? [event(a.event)] : [],
      isNew: true,
      forMe: true,
    });
  }

  for (const m of f.mentions) {
    total += 1;
    count(m.subjects);
    rows.push({
      id: `mention:${m.taskId}:${m.actor.id}`,
      group: "tasks",
      face: m.actor,
      title: `${firstName(m.actor.name)} mentioned you in ${m.title}`,
      sub: null,
      href: `${f.base}/tasks/${m.taskId}`,
      chips: m.event ? [event(m.event)] : [],
      isNew: false,
      forMe: true,
    });
  }

  for (const c of f.comments) {
    total += c.count;
    count(c.subjects, c.count);
    rows.push({
      id: `comment:${c.taskId}:${c.actor.id}`,
      group: "tasks",
      face: c.actor,
      title: `${firstName(c.actor.name)} commented on ${c.title}`,
      sub: c.count > 1 ? plural(c.count, "comment") : null,
      href: `${f.base}/tasks/${c.taskId}`,
      chips: c.event ? [event(c.event)] : [],
      isNew: false,
      forMe: true,
    });
  }

  // Finished tasks: one row per person and epic.
  const finishedBy = new Map<string, SinceFacts["finished"]>();
  for (const t of f.finished) {
    total += 1;
    count(t.subjects);
    const k = `${t.actor.id}|${t.epic?.id ?? ""}`;
    finishedBy.set(k, [...(finishedBy.get(k) ?? []), t]);
  }
  for (const [k, list] of finishedBy) {
    const first = list[0];
    const who = firstName(first.actor.name);
    const where = first.epic ? ` in ${first.epic.title}` : "";
    const titles = list.map((t) => t.title);
    rows.push({
      id: `finished:${k}`,
      group: "tasks",
      face: first.actor,
      title:
        list.length === 1
          ? `${who} finished ${first.title}`
          : `${who} finished ${plural(list.length, "task")}${where}`,
      sub:
        list.length === 1
          ? first.epic
            ? `In ${first.epic.title}`
            : null
          : titles.length > 3
            ? `${titles.slice(0, 3).join(", ")} and ${titles.length - 3} more`
            : listWords(titles),
      href:
        list.length === 1
          ? `${f.base}/tasks/${first.taskId}`
          : first.epic
            ? `${f.base}/tasks/${first.epic.id}`
            : `${f.base}/tasks`,
      chips: [
        ...(first.epic && list.length === 1
          ? [task({ taskId: first.epic.id, title: first.epic.title })]
          : []),
        ...(first.event ? [event(first.event)] : []),
      ],
      isNew: false,
      forMe: false,
    });
  }

  for (const n of f.notes) {
    // An edit and its comments, or (commented on only) just the comments.
    const changes = n.commentedOnly ? Math.max(1, n.comments) : 1 + n.comments;
    total += changes;
    if (n.event) count([{ key: `event:${n.event.id}`, title: n.event.title }], changes);
    const who = firstName(n.actor.name);
    const did = n.commentedOnly ? "commented on" : n.created ? "wrote" : "edited";
    rows.push({
      id: `note:${n.noteId}`,
      group: "notes",
      face: n.actor,
      title: `${who} ${did} ${n.title}`,
      sub:
        n.commentedOnly && n.comments <= 1
          ? null
          : n.comments > 0
            ? plural(n.comments, n.commentedOnly ? "comment" : "new comment")
            : null,
      href: `${f.base}/notes/${n.noteId}`,
      chips: [
        { kind: "note", label: n.title, href: `${f.base}/notes/${n.noteId}` },
        ...(n.event ? [event(n.event)] : []),
      ],
      isNew: false,
      forMe: n.mine,
    });
  }

  const people = f.joined.people;
  if (people.length > 0) {
    total += people.length;
    const names = people.map((p) => firstName(p.name));
    const going = f.joined.goingTo;
    rows.push({
      id: "people",
      group: "people",
      face: people.length === 1 ? people[0] : null,
      newcomerId: people.length === 1 ? people[0].id : undefined,
      count: people.length,
      title:
        people.length === 1
          ? `${names[0]} joined`
          : `${plural(people.length, "person", "people")} joined`,
      sub: going
        ? `${going.count === people.length && people.length > 1 ? "All of them" : people.length === 1 ? "They" : `${going.count} of them`} ${going.count === 1 && people.length > 1 ? "is" : "are"} going to ${going.title}`
        : people.length > 1
          ? names.length > 3
            ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
            : listWords(names)
          : null,
      href: `${f.base}/people`,
      chips: [
        ...people.slice(0, 2).map((p): ItemRef => ({
          kind: "person",
          label: p.name ?? "Member",
          href: `${f.base}/people/${p.id}`,
        })),
        ...(going ? [event(going)] : []),
      ],
      isNew: false,
      forMe: false,
    });
  }

  const VERB: Record<SinceFacts["money"][number]["change"], string> = {
    submitted: "asked to be paid back for",
    approved: "approved",
    paid: "paid back",
    declined: "declined",
  };
  for (const m of f.money) {
    total += 1;
    if (m.event) count([{ key: `event:${m.event.id}`, title: m.event.title }]);
    const who = firstName(m.actor.name);
    const title =
      m.mine && m.change !== "submitted"
        ? `${who} ${VERB[m.change]} your ${m.description}`
        : `${who} ${VERB[m.change]} ${m.description}`;
    rows.push({
      id: `money:${m.id}:${m.change}`,
      group: "money",
      face: m.actor,
      title,
      sub:
        m.change === "submitted"
          ? `${money(m.amountCents)}, ${m.receipts > 0 ? "receipt attached" : "no receipt yet"}`
          : money(m.amountCents),
      href: `${f.base}/finance/transactions?open=${m.id}`,
      chips: [
        ...(m.category
          ? [
              {
                kind: "money" as const,
                label: m.category.name,
                href: `${f.base}/finance/budget?period=${m.category.periodId}`,
              },
            ]
          : []),
        ...(m.event ? [event(m.event)] : []),
      ],
      isNew: false,
      forMe: m.mine,
    });
  }

  // Each group keeps its first few rows.
  const order: SinceGroup[] = ["assigned", "tasks", "notes", "people", "money"];
  const shown = order.flatMap((g) => rows.filter((r) => r.group === g).slice(0, PER_GROUP));

  return { rows: shown, total, insight: sinceInsight(total, subjects, f.assigned) };
}

/**
 * "19 changes, and 11 of them were about Fall Social. One needs you:
 * Oliver gave you Send the room request." Each half only when it's true:
 * a subject has to be a real share of the changes to be named.
 */
export function sinceInsight(
  total: number,
  subjects: ReadonlyMap<string, { title: string; count: number }>,
  assigned: readonly { title: string; actor: PersonFace }[],
): SinceInsightRun[] | null {
  if (total === 0) return null;
  const runs: SinceInsightRun[] = [];
  const top = [...subjects.values()].sort((a, b) => b.count - a.count)[0];
  const named = top && top.count >= 3 && top.count * 5 >= total * 2 && total > top.count;
  if (named) {
    runs.push(
      { text: plural(total, "change"), bold: true },
      { text: `, and ${top.count} of them were about ` },
      { text: top.title, bold: true },
      { text: "." },
    );
  } else if (total >= 3) {
    runs.push({ text: plural(total, "change"), bold: true }, { text: " since your last visit." });
  }
  if (assigned.length === 1) {
    const a = assigned[0];
    runs.push(
      { text: `${runs.length > 0 ? " " : ""}One needs you: ${firstName(a.actor.name)} gave you ` },
      { text: a.title, bold: true },
      { text: "." },
    );
  } else if (assigned.length > 1) {
    runs.push({
      text: `${runs.length > 0 ? " " : ""}${assigned.length} of them are work handed to you.`,
    });
  }
  return runs.length > 0 ? runs : null;
}

/** "Thursday, 9:40 PM" within the week, else "Oct 3, 9:40 PM". */
export function sinceLabel(since: Date, now: Date, timeZone: string): string {
  const days = (now.getTime() - since.getTime()) / 86_400_000;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(since);
  const day = new Intl.DateTimeFormat("en-US", {
    ...(days < 6 ? { weekday: "long" } : { month: "short", day: "numeric" }),
    timeZone,
  }).format(since);
  return `${day}, ${time}`;
}
