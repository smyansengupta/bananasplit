import type { TaskPriority } from "@/generated/prisma/client";
import { refFromPath, type LinkRef } from "@/lib/links";
import type { ItemRef, PersonFace } from "@/lib/overview/types";
import { pollHref } from "@/lib/polls/paths";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { readLinks, resolveRefs } from "@/server/links/links";
import { userPublicSelect } from "@/server/members";
import type { OpenPoll } from "@/server/polls/open-polls";
import { pollVoteCounts } from "@/server/polls/question-polls";
import type { ReportTier } from "@/server/reports/types";
import { queryDatabaseVisibility } from "@/server/reports/visibility";

import type { OpenElection, OpenForm } from "./home-data";

export type { PersonFace };

/**
 * The Overview's extra reads (src/app/app/[orgSlug]/page.tsx), as the
 * member (withOrgTx: RLS bounds every one to the organization and to what
 * they may see), one after another on the page's transaction. Every list is
 * bounded. The exceptions say so: sign-up and check-in counts are read on
 * the service path, and only numbers come back.
 */

export interface TaskExtras {
  priority: TaskPriority;
  subtasks: { done: number; total: number };
  people: PersonFace[];
}

/** Priority, subtask progress and faces for the viewer's task rows. */
export async function loadTaskExtras(
  db: TxClient,
  organizationId: string,
  taskIds: readonly string[],
): Promise<Map<string, TaskExtras>> {
  if (taskIds.length === 0) return new Map();
  // One relation per query: Prisma runs sibling relations concurrently,
  // which the page's single transaction connection can't do.
  const tasks = await db.task.findMany({
    where: { organizationId, id: { in: [...taskIds] } },
    select: { id: true, priority: true, owner: { select: userPublicSelect } },
  });
  const assignees = await db.taskAssignee.findMany({
    where: { organizationId, taskId: { in: [...taskIds] } },
    select: { taskId: true, user: { select: userPublicSelect } },
    take: 200,
  });
  const rows = tasks.map((t) => ({
    ...t,
    assignees: assignees.filter((a) => a.taskId === t.id).slice(0, 4),
  }));
  const subtasks = await db.task.groupBy({
    by: ["parentTaskId", "status"],
    where: { organizationId, deletedAt: null, parentTaskId: { in: [...taskIds] } },
    _count: { _all: true },
  });
  const out = new Map<string, TaskExtras>();
  for (const row of rows) {
    const mine = subtasks.filter((s) => s.parentTaskId === row.id);
    const people: PersonFace[] = [];
    for (const p of [row.owner, ...row.assignees.map((a) => a.user)]) {
      if (p && !people.some((q) => q.id === p.id)) people.push(p);
    }
    out.set(row.id, {
      priority: row.priority,
      subtasks: {
        total: mine.reduce((n, s) => n + s._count._all, 0),
        done: mine.filter((s) => s.status === "COMPLETED").reduce((n, s) => n + s._count._all, 0),
      },
      people,
    });
  }
  return out;
}

export interface EventGoing {
  going: number;
  faces: PersonFace[];
}

/** Members going (RSVP yes) to each event, with the first three faces. */
export async function loadEventGoing(
  db: TxClient,
  organizationId: string,
  eventIds: readonly string[],
): Promise<Map<string, EventGoing>> {
  const out = new Map<string, EventGoing>();
  if (eventIds.length === 0) return out;
  const rows = await db.eventAttendee.findMany({
    where: { organizationId, eventId: { in: [...eventIds] }, rsvp: "YES" },
    select: { eventId: true, user: { select: userPublicSelect } },
    take: 500,
  });
  for (const row of rows) {
    const slot = out.get(row.eventId) ?? { going: 0, faces: [] };
    slot.going += 1;
    if (slot.faces.length < 3) slot.faces.push(row.user);
    out.set(row.eventId, slot);
  }
  return out;
}

export interface PollStat extends OpenPoll {
  /** Members who have voted or answered. */
  voters: number;
  /** Who can vote: every member. */
  eligible: number;
  /** Whether the viewer has answered. */
  mine: boolean;
  /** A few of the people who answered (none on an anonymous poll). */
  faces: PersonFace[];
  /**
   * A one-choice question with a few options: its options, so Up next can
   * take the vote right on the card. Absent otherwise.
   */
  choices?: { id: string; label: string }[];
}

/** Up next votes on the card only up to this many options. */
const CARD_CHOICES = 4;

/** Turnout for each open poll, and whether the viewer has answered. */
export async function loadPollStats(
  db: TxClient,
  organizationId: string,
  userId: string,
  polls: readonly OpenPoll[],
  memberCount: number,
): Promise<PollStat[]> {
  const questionIds = polls.filter((p) => p.kind === "question").map((p) => p.id);
  const availabilityIds = polls.filter((p) => p.kind === "availability").map((p) => p.id);
  const voters = new Map<string, number>();
  const mine = new Set<string>();
  const faces = new Map<string, PersonFace[]>();
  const addFace = (pollId: string, face: PersonFace) => {
    const list = faces.get(pollId) ?? [];
    if (list.length < 3 && !list.some((f) => f.id === face.id)) list.push(face);
    faces.set(pollId, list);
  };

  if (questionIds.length > 0) {
    for (const row of await pollVoteCounts(db, questionIds)) voters.set(row.pollId, row.voters);
    // Under RLS: everyone's votes on an open poll, only your own on an anonymous one.
    const votes = await db.pollVote.findMany({
      where: { organizationId, pollId: { in: questionIds } },
      select: { pollId: true, userId: true, user: { select: userPublicSelect } },
      distinct: ["pollId", "userId"],
      take: 300,
    });
    for (const v of votes) {
      if (v.userId === userId) mine.add(v.pollId);
      addFace(v.pollId, v.user);
    }
  }
  if (availabilityIds.length > 0) {
    const responses = await db.pollResponse.findMany({
      where: { organizationId, pollId: { in: availabilityIds }, userId: { not: null } },
      select: { pollId: true, userId: true, user: { select: userPublicSelect } },
      distinct: ["pollId", "userId"],
      take: 500,
    });
    for (const r of responses) {
      voters.set(r.pollId, (voters.get(r.pollId) ?? 0) + 1);
      if (r.userId === userId) mine.add(r.pollId);
      if (r.user) addFace(r.pollId, r.user);
    }
  }
  // One-choice questions with a handful of options can be answered on the card.
  const choices = new Map<string, { id: string; label: string }[]>();
  if (questionIds.length > 0) {
    const single = await db.poll.findMany({
      where: { organizationId, id: { in: questionIds }, multiple: false },
      select: {
        id: true,
        options: { select: { id: true, label: true }, orderBy: { sortOrder: "asc" } },
      },
    });
    for (const p of single) {
      if (p.options.length > 1 && p.options.length <= CARD_CHOICES) choices.set(p.id, p.options);
    }
  }
  return polls.map((p) => ({
    ...p,
    voters: voters.get(p.id) ?? 0,
    eligible: Math.max(memberCount, voters.get(p.id) ?? 0),
    mine: mine.has(p.id),
    faces: faces.get(p.id) ?? [],
    ...(choices.has(p.id) ? { choices: choices.get(p.id) } : {}),
  }));
}

/**
 * A row of Home's "Open forms": the same open forms, member polls and
 * website polls the Forms list shows, each linking where Forms links it.
 */
export interface OpenFormStat {
  id: string;
  kind: "form" | "poll" | "question" | "website";
  title: string;
  href: string;
  /**
   * Responses so far; null where the viewer can't read them (a form's
   * responses are owners' and admins' to read, RLS), rather than a 0.
   */
  responses: number | null;
  /** Who can answer, when that's a known number (members-only forms, member polls). */
  outOf: number | null;
  closesAt: Date | null;
  mine: boolean;
  /** Responses waiting on a review, where the form has one and the viewer can see them. */
  toReview: number;
  at: number;
}

/**
 * Open forms and website polls, newest first, with the member polls from
 * `polls` (already counted for Up next) mixed in: the page's shared reads
 * (./home-data.ts), no queries of its own. Drafts, closed and full forms
 * are already out, as in the Forms list's Open tab. A viewer who can't read
 * responses gets no count on a form rather than a 0.
 */
export function loadOpenForms({
  base,
  forms,
  website,
  polls,
  answered,
  readsResponses,
  limit,
}: {
  base: string;
  forms: readonly OpenForm[];
  website: readonly OpenElection[];
  polls: readonly PollStat[];
  /** Forms the viewer has answered. */
  answered: ReadonlySet<string>;
  /** Owners and admins: who may read a form's responses (RLS). */
  readsResponses: boolean;
  limit: number;
}): OpenFormStat[] {
  const rows: OpenFormStat[] = [
    ...forms.map((form) => ({
      id: form.id,
      kind: form.kind === "QUICK_POLL" ? ("poll" as const) : ("form" as const),
      title: form.title,
      href: `${base}/forms/${form.id}`,
      responses: readsResponses ? form.responses : null,
      outOf: form.members,
      closesAt: form.closesAt,
      mine: answered.has(form.id),
      toReview: form.toReview,
      at: form.createdAt.getTime(),
    })),
    ...polls
      .filter((p) => p.kind === "question")
      .map((p) => ({
        id: p.id,
        kind: "question" as const,
        title: p.title,
        href: pollHref(base, "question", p.id),
        responses: p.voters,
        outOf: p.eligible,
        closesAt: p.closesAt,
        mine: p.mine,
        toReview: 0,
        at: p.createdAt.getTime(),
      })),
    ...website.map((p) => ({
      id: p.id,
      kind: "website" as const,
      title: p.title,
      href: p.databaseKey
        ? `${base}/databases/${p.databaseKey}?f=${encodeURIComponent(`poll:eq:${p.slug}`)}`
        : `${base}/forms`,
      responses: p.responses,
      outOf: null,
      closesAt: p.closesAt,
      mine: false,
      toReview: 0,
      at: (p.opensAt ?? p.createdAt).getTime(),
    })),
  ];
  return rows.sort((a, b) => b.at - a.at).slice(0, limit);
}

// --- What each item on Home is linked to, and the facts behind its insight ---

/** A linked thing as Home draws it (a LinkChip), with what it is underneath. */
export interface LinkedChip extends ItemRef {
  /** The ItemLink kind and id of the thing linked ("task", "t_1"). */
  ref: LinkRef;
  /** A linked task that's done (for "2 of 6 action items open"). */
  done?: boolean;
}

/** Linked things that never show on Home: money stays on Finance. */
const OFF_HOME = new Set<string>(["transaction", "budget"]);

const refKey = (r: LinkRef) => `${r.kind}:${r.id}`;

/**
 * What each of `refs` is linked to (ItemLink, either way round), as chips,
 * keyed "kind:id". Every other end is looked up as the viewer
 * (resolveRefs), so a thing they can't see never becomes a chip; money
 * (transactions, budget lines) is left out. Newest link first, and a
 * repeating meeting once (two occurrences linked read as one chip).
 */
export async function loadLinkedChips(
  db: TxClient,
  organizationId: string,
  orgSlug: string,
  refs: readonly LinkRef[],
  timeZone: string,
): Promise<Map<string, LinkedChip[]>> {
  const out = new Map<string, LinkedChip[]>();
  const ends = (await readLinks(db, organizationId, refs, { take: 400 })).filter(
    (l) => !OFF_HOME.has(l.other.kind),
  );
  if (ends.length === 0) return out;
  const resolved = await resolveRefs(
    db,
    organizationId,
    orgSlug,
    ends.map((l) => l.other),
    timeZone,
  );
  for (const { at, other } of ends) {
    const hit = resolved.get(refKey(other));
    if (!hit) continue;
    const list = out.get(at) ?? [];
    if (list.some((c) => refKey(c.ref) === refKey(other))) continue;
    // A repeating meeting shows once: the newest link (the one carried over to).
    if (
      other.kind === "event" &&
      list.some((c) => c.ref.kind === "event" && c.label === hit.title)
    ) {
      continue;
    }
    list.push({
      kind: hit.chip,
      label: hit.title,
      href: hit.href,
      ref: other,
      ...(other.kind === "task" ? { done: hit.done ?? false } : {}),
    });
    out.set(at, list);
  }
  return out;
}

/** What Home's Meetings and Events need beyond the calendar's summary. */
export interface EventDetail {
  id: string;
  /** A meeting's agenda is its description (MeetingAgenda). */
  description: string | null;
  seriesId: string | null;
  rsvpEnabled: boolean;
  capacity: number | null;
  hideCount: boolean;
  /** Notes written for it (Note.eventId) that the viewer can read. */
  notes: { id: string; title: string }[];
}

export async function loadEventDetails(
  db: TxClient,
  organizationId: string,
  eventIds: readonly string[],
): Promise<Map<string, EventDetail>> {
  const out = new Map<string, EventDetail>();
  if (eventIds.length === 0) return out;
  const rows = await db.event.findMany({
    where: { organizationId, id: { in: [...eventIds] } },
    select: {
      id: true,
      description: true,
      seriesId: true,
      rsvpEnabled: true,
      rsvpCapacity: true,
      rsvpHideCount: true,
    },
  });
  // Under RLS: only the notes this member may read.
  const notes = await db.note.findMany({
    where: { organizationId, eventId: { in: [...eventIds] }, deletedAt: null },
    select: { id: true, title: true, eventId: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  for (const e of rows) {
    out.set(e.id, {
      id: e.id,
      description: e.description,
      seriesId: e.seriesId,
      rsvpEnabled: e.rsvpEnabled,
      capacity: e.rsvpCapacity,
      hideCount: e.rsvpHideCount,
      notes: notes
        .filter((n) => n.eventId === e.id)
        .map((n) => ({ id: n.id, title: n.title || "Untitled note" })),
    });
  }
  return out;
}

/**
 * The last meeting of each upcoming meeting's series (same seriesId, already
 * started), keyed by series. Its linked tasks are the action items it made.
 */
export async function loadLastInSeries(
  db: TxClient,
  organizationId: string,
  seriesIds: readonly string[],
  now: Date,
): Promise<Map<string, { id: string; title: string; startsAt: Date }>> {
  const out = new Map<string, { id: string; title: string; startsAt: Date }>();
  if (seriesIds.length === 0) return out;
  const rows = await db.event.findMany({
    where: {
      organizationId,
      deletedAt: null,
      seriesId: { in: [...seriesIds] },
      startsAt: { lt: now },
    },
    select: { id: true, title: true, startsAt: true, seriesId: true },
    orderBy: { startsAt: "desc" },
    take: 50,
  });
  for (const r of rows) {
    if (r.seriesId && !out.has(r.seriesId))
      out.set(r.seriesId, { id: r.id, title: r.title, startsAt: r.startsAt });
  }
  return out;
}

/** RSVPs and check-ins of one event. */
export interface Turnout {
  /** Sign-ups going on its RSVP page, or members who answered Going without one. */
  rsvps: number;
  /** Check-ins: the larger of the event's own (Attendance) and its RSVP page's. */
  checkIns: number;
}

/**
 * RSVPs against check-ins for `events`. Run it on the service path:
 * sign-ups hold guests' contact details, so members can't read them (RLS),
 * but the numbers are what the public page shows. Only counts leave here.
 */
export async function turnoutOf(
  db: TxClient,
  organizationId: string,
  events: readonly { id: string; rsvpEnabled: boolean; attendanceCount: number }[],
): Promise<Map<string, Turnout>> {
  const out = new Map<string, Turnout>();
  if (events.length === 0) return out;
  const ids = events.map((e) => e.id);
  const going = await db.eventRegistration.groupBy({
    by: ["eventId"],
    where: { organizationId, eventId: { in: ids }, status: "GOING" },
    _count: { _all: true },
  });
  const scanned = await db.eventRegistration.groupBy({
    by: ["eventId"],
    where: { organizationId, eventId: { in: ids }, checkedInAt: { not: null } },
    _count: { _all: true },
  });
  const members = await db.eventAttendee.groupBy({
    by: ["eventId"],
    where: { organizationId, eventId: { in: ids }, rsvp: "YES" },
    _count: { _all: true },
  });
  const count = (rows: { eventId: string; _count: { _all: number } }[], id: string) =>
    rows.find((r) => r.eventId === id)?._count._all ?? 0;
  for (const e of events) {
    const rsvps = e.rsvpEnabled ? count(going, e.id) : count(members, e.id);
    out.set(e.id, { rsvps, checkIns: Math.max(e.attendanceCount, count(scanned, e.id)) });
  }
  return out;
}

/** How many of a kind's RSVPs turn into check-ins, from past events. */
export interface CheckInRate {
  /** Check-ins over RSVPs, summed over the events (0.81). */
  rate: number;
  events: number;
}

/** At least this many past events with both RSVPs and check-ins before a rate is said. */
const MIN_RATE_EVENTS = 2;
const RATE_LOOKBACK_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Home's Events numbers: seats taken on each upcoming event's RSVP page
 * (left out where the page hides its count from someone who isn't an
 * admin), and each event kind's check-in rate over the last year, only for
 * a viewer who may see attendance (Settings > Privacy, as for Reports).
 */
export async function loadEventTurnout(
  organizationId: string,
  input: {
    upcoming: readonly { id: string; rsvpEnabled: boolean; hideCount: boolean }[];
    isAdmin: boolean;
    tier: ReportTier;
    now: Date;
    /** Events under way or just ended: their check-ins so far against RSVPs. */
    live?: readonly string[];
  },
): Promise<{
  seats: Map<string, number>;
  rates: Map<string, CheckInRate>;
  live: Map<string, Turnout>;
}> {
  return withSystemOrgTx(organizationId, async ({ db }) => {
    const shown = input.upcoming.filter((e) => e.rsvpEnabled && (input.isAdmin || !e.hideCount));
    const seats = new Map<string, number>();
    if (shown.length > 0) {
      const rows = await db.eventRegistration.groupBy({
        by: ["eventId"],
        where: { organizationId, eventId: { in: shown.map((e) => e.id) }, status: "GOING" },
        _count: { _all: true },
      });
      for (const e of shown)
        seats.set(e.id, rows.find((r) => r.eventId === e.id)?._count._all ?? 0);
    }
    const rates = new Map<string, CheckInRate>();
    const live = new Map<string, Turnout>();
    const visible = await queryDatabaseVisibility(db, organizationId, input.tier, ["ATTENDANCE"]);
    if (!visible.ATTENDANCE) return { seats, rates, live };
    if (input.live && input.live.length > 0) {
      const now = await db.event.findMany({
        where: {
          organizationId,
          id: { in: [...input.live] },
          ...(input.isAdmin ? {} : { rsvpHideCount: false }),
        },
        select: { id: true, rsvpEnabled: true, attendanceCount: true },
      });
      for (const [id, t] of await turnoutOf(db, organizationId, now)) live.set(id, t);
    }
    const past = await db.event.findMany({
      where: {
        organizationId,
        deletedAt: null,
        mergedIntoId: null,
        startsAt: { lt: input.now, gte: new Date(input.now.getTime() - RATE_LOOKBACK_MS) },
        ...(input.isAdmin ? {} : { rsvpHideCount: false }),
      },
      select: { id: true, kind: true, rsvpEnabled: true, attendanceCount: true },
      orderBy: { startsAt: "desc" },
      take: 80,
    });
    const turnout = await turnoutOf(db, organizationId, past);
    const sums = new Map<string, { rsvps: number; checkIns: number; events: number }>();
    for (const e of past) {
      const t = turnout.get(e.id);
      if (!t || t.rsvps === 0 || t.checkIns === 0) continue;
      const s = sums.get(e.kind) ?? { rsvps: 0, checkIns: 0, events: 0 };
      sums.set(e.kind, {
        rsvps: s.rsvps + t.rsvps,
        checkIns: s.checkIns + t.checkIns,
        events: s.events + 1,
      });
    }
    for (const [kind, s] of sums) {
      if (s.events >= MIN_RATE_EVENTS)
        rates.set(kind, { rate: s.checkIns / s.rsvps, events: s.events });
    }
    return { seats, rates, live };
  });
}

/** What changed on a page the viewer opened, since they last opened it. */
export interface PickUpChange {
  /** "Priya edited it since you opened it.", "2 new responses since you opened it." */
  line: string;
  /** New things since the visit, for the "2 new" chip. */
  fresh: number;
}

/** The linkable thing an in-app address is (refFromPath, plus calendar events). */
export function refOfHref(href: string): LinkRef | null {
  const path = href.split("?")[0] ?? href;
  const calendar = /^\/app\/[^/]+\/calendar\/([A-Za-z0-9_-]{1,64})$/.exec(path);
  if (calendar && !["polls", "new"].includes(calendar[1]!))
    return { kind: "event", id: calendar[1]! };
  return refFromPath(path);
}

/**
 * For "Pick up where you left off": what changed on each page since the
 * viewer last opened it, where that can be counted: a note edited by
 * someone else or commented on, a task commented on or changed, a form's
 * new responses. Read as the viewer; any other page gets no line.
 */
export async function loadPickUpChanges(
  db: TxClient,
  organizationId: string,
  userId: string,
  items: readonly { href: string; visitedAt: Date }[],
): Promise<Map<string, PickUpChange>> {
  const out = new Map<string, PickUpChange>();
  const refs = items.flatMap((item) => {
    const ref = refOfHref(item.href);
    return ref ? [{ ...ref, href: item.href, since: item.visitedAt }] : [];
  });
  const of = (kind: string) => refs.filter((r) => r.kind === kind);
  const fresh = (n: number, one: string) => `${n} new ${one}${n === 1 ? "" : "s"}`;
  const oldest = (list: { since: Date }[]) =>
    new Date(Math.min(...list.map((r) => r.since.getTime())));

  const notes = of("note");
  if (notes.length > 0) {
    const rows = await db.note.findMany({
      where: { organizationId, id: { in: notes.map((n) => n.id) }, deletedAt: null },
      select: {
        id: true,
        updatedAt: true,
        updatedById: true,
        updatedBy: { select: { name: true } },
      },
    });
    const comments = await db.noteComment.findMany({
      where: {
        organizationId,
        noteId: { in: notes.map((n) => n.id) },
        createdAt: { gt: oldest(notes) },
        NOT: { authorId: userId },
      },
      select: { noteId: true, createdAt: true },
      take: 300,
    });
    for (const n of notes) {
      const row = rows.find((r) => r.id === n.id);
      if (!row) continue;
      const count = comments.filter((c) => c.noteId === n.id && c.createdAt > n.since).length;
      const edited = row.updatedAt > n.since && row.updatedById !== userId;
      const who = row.updatedBy?.name?.split(/\s+/)[0] ?? "Someone";
      const line =
        edited && count > 0
          ? `${who} edited it since you opened it. ${fresh(count, "comment")}.`
          : edited
            ? `${who} edited it since you opened it.`
            : count > 0
              ? `${fresh(count, "comment")} since you opened it.`
              : "Unchanged since you opened it.";
      out.set(n.href, { line, fresh: count });
    }
  }

  const tasks = of("task");
  if (tasks.length > 0) {
    const ids = tasks.map((t) => t.id);
    const rows = await db.task.findMany({
      where: { organizationId, id: { in: ids }, deletedAt: null },
      select: { id: true, status: true },
    });
    const comments = await db.taskComment.findMany({
      where: {
        organizationId,
        taskId: { in: ids },
        deletedAt: null,
        createdAt: { gt: oldest(tasks) },
        NOT: { authorId: userId },
      },
      select: { taskId: true, createdAt: true },
      take: 300,
    });
    const changes = await db.taskActivity.findMany({
      where: {
        organizationId,
        taskId: { in: ids },
        createdAt: { gt: oldest(tasks) },
        NOT: { actorId: userId },
      },
      select: { taskId: true, createdAt: true },
      take: 300,
    });
    for (const t of tasks) {
      const row = rows.find((r) => r.id === t.id);
      if (!row) continue;
      const count = comments.filter((c) => c.taskId === t.id && c.createdAt > t.since).length;
      const changed = changes.some((c) => c.taskId === t.id && c.createdAt > t.since);
      const done = row.status === "COMPLETED" ? " It's done now." : "";
      const line =
        count > 0
          ? `${fresh(count, "comment")} since you opened it.${done}`
          : changed
            ? `Someone changed it since you opened it.${done}`
            : `Unchanged since you opened it.${done}`;
      out.set(t.href, { line, fresh: count });
    }
  }

  const forms = of("form");
  if (forms.length > 0) {
    const rows = await db.formResponse.findMany({
      where: {
        organizationId,
        formId: { in: forms.map((f) => f.id) },
        createdAt: { gt: oldest(forms) },
      },
      select: { formId: true, createdAt: true },
      take: 1000,
    });
    // Only what's there: a member who can't read responses (RLS) sees none,
    // which is no reason to say there are none.
    for (const f of forms) {
      const count = rows.filter((r) => r.formId === f.id && r.createdAt > f.since).length;
      if (count > 0)
        out.set(f.href, { line: `${fresh(count, "response")} since you opened it.`, fresh: count });
    }
  }
  return out;
}

/** Each form's responses since `since` (Open forms' "3 new this week"). */
export async function loadFormResponsesSince(
  db: TxClient,
  organizationId: string,
  formIds: readonly string[],
  since: Date,
): Promise<Map<string, number>> {
  if (formIds.length === 0) return new Map();
  const rows = await db.formResponse.groupBy({
    by: ["formId"],
    where: { organizationId, formId: { in: [...formIds] }, createdAt: { gte: since } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.formId, r._count._all]));
}

/**
 * Pinned's live line per pin id: what the Linked panel says about the thing
 * (resolveRefs: a form's responses, a task's due date, an event's RSVPs, a
 * database's rows), and what's new on it since the viewer last opened it.
 */
export async function loadPinStates(
  db: TxClient,
  organizationId: string,
  orgSlug: string,
  userId: string,
  pins: readonly { id: string; href: string }[],
  timeZone: string,
): Promise<Record<string, string>> {
  const refs = pins.flatMap((pin) => {
    const ref = refOfHref(pin.href);
    return ref ? [{ pin, ref }] : [];
  });
  if (refs.length === 0) return {};
  const resolved = await resolveRefs(
    db,
    organizationId,
    orgSlug,
    refs.map((r) => r.ref),
    timeZone,
  );
  const visits = await db.recentVisit.findMany({
    where: { organizationId, userId, href: { in: refs.map((r) => r.pin.href) } },
    select: { href: true, visitedAt: true },
  });
  const changes = await loadPickUpChanges(db, organizationId, userId, visits);
  const out: Record<string, string> = {};
  for (const { pin, ref } of refs) {
    const hit = resolved.get(refKey(ref));
    if (!hit) continue;
    const fresh = changes.get(pin.href)?.fresh ?? 0;
    out[pin.id] = fresh > 0 ? `${hit.detail}, ${fresh} new since you opened it` : hit.detail;
  }
  return out;
}
