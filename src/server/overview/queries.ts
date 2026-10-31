import type { TaskPriority } from "@/generated/prisma/client";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";
import type { OpenPoll } from "@/server/polls/open-polls";
import { pollVoteCounts } from "@/server/polls/question-polls";

/**
 * The Overview's extra reads (src/app/app/[orgSlug]/page.tsx), as the
 * member (withOrgTx: RLS bounds every one to the club and to what they may
 * see), one after another on the page's transaction. Every list is bounded.
 */

export interface PersonFace {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
}

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
  const rows = (tasks ?? []).map((t) => ({
    ...t,
    assignees: (assignees ?? []).filter((a) => a.taskId === t.id).slice(0, 4),
  }));
  const subtasks = await db.task.groupBy({
    by: ["parentTaskId", "status"],
    where: { organizationId, deletedAt: null, parentTaskId: { in: [...taskIds] } },
    _count: { _all: true },
  });
  const out = new Map<string, TaskExtras>();
  for (const row of rows ?? []) {
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
  for (const row of rows ?? []) {
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
    for (const v of votes ?? []) {
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
    for (const r of responses ?? []) {
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

export interface RsvpGoalEvent {
  id: string;
  title: string;
  startsAt: Date;
  allDay: boolean;
  capacity: number;
  hideCount: boolean;
}

/** The next event with an RSVP page and a capacity, or null. */
export async function nextRsvpGoalEvent(
  db: TxClient,
  organizationId: string,
  now: Date,
): Promise<RsvpGoalEvent | null> {
  const event = await db.event.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      mergedIntoId: null,
      rsvpEnabled: true,
      rsvpCapacity: { not: null },
      startsAt: { gt: now },
    },
    select: {
      id: true,
      title: true,
      startsAt: true,
      allDay: true,
      rsvpCapacity: true,
      rsvpHideCount: true,
    },
    orderBy: { startsAt: "asc" },
  });
  if (!event?.rsvpCapacity) return null;
  return {
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    allDay: event.allDay,
    capacity: event.rsvpCapacity,
    hideCount: event.rsvpHideCount,
  };
}

/**
 * Seats taken on an RSVP page. Registrations hold guests' contact details,
 * so members can't read them (RLS: admins only); this reads the one number
 * on the service path, as the public page itself shows it (src/server/rsvp/
 * page.ts). Callers leave it out when the page hides its count from
 * someone who isn't an admin.
 */
export async function rsvpSeatsTaken(organizationId: string, eventId: string): Promise<number> {
  return withSystemOrgTx(organizationId, ({ db }) =>
    db.eventRegistration.count({ where: { organizationId, eventId, status: "GOING" } }),
  );
}
