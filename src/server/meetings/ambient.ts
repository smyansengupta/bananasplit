import {
  decisionsToLog,
  noteItems,
  todosWithoutTasks,
  type NoteTodo,
} from "@/lib/ambient/meetings";
import type { TxClient } from "@/server/db/context";

/**
 * What a meeting's ambient buttons act on (Buttons2: Meetings), read as the
 * member (RLS applies, so a private note or task they can't see adds
 * nothing): its tasks, last time's tasks still open, the to-dos and
 * decisions in its notes, and (for hosts) its check-ins and whether it has
 * been thanked. The page reads it to decide what shows; the actions read it
 * again, so they act on what's true then, not on what the page saw.
 */

const OPEN = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"] as const;

export interface MeetingRef {
  id: string;
  title: string;
  startsAt: Date;
  seriesId: string | null;
}

/** The tasks linked to a meeting, either way round. */
export async function linkedTaskIds(
  db: TxClient,
  organizationId: string,
  eventId: string,
): Promise<string[]> {
  const links = await db.itemLink.findMany({
    where: {
      organizationId,
      OR: [
        { fromKind: "event", fromId: eventId, toKind: "task" },
        { toKind: "event", toId: eventId, fromKind: "task" },
      ],
    },
    select: { fromKind: true, fromId: true, toId: true },
  });
  return [...new Set(links.map((l) => (l.fromKind === "task" ? l.fromId : l.toId)))];
}

/** Last time: the series' meeting before this one, else the last one of the same name. */
export async function previousMeeting(
  db: TxClient,
  organizationId: string,
  event: MeetingRef,
): Promise<{ id: string; title: string } | null> {
  return db.event.findFirst({
    where: {
      organizationId,
      deletedAt: null,
      mergedIntoId: null,
      id: { not: event.id },
      startsAt: { lt: event.startsAt },
      ...(event.seriesId
        ? { seriesId: event.seriesId }
        : { title: { equals: event.title, mode: "insensitive" } }),
    },
    orderBy: { startsAt: "desc" },
    select: { id: true, title: true },
  });
}

/** Last time's tasks still open and not yet on this meeting: Carry them over. */
export async function carryOverTasks(
  db: TxClient,
  organizationId: string,
  event: MeetingRef,
  linkedIds: readonly string[],
): Promise<{ id: string; title: string }[]> {
  const prev = await previousMeeting(db, organizationId, event);
  if (!prev) return [];
  const theirs = (await linkedTaskIds(db, organizationId, prev.id)).filter(
    (id) => !linkedIds.includes(id),
  );
  if (theirs.length === 0) return [];
  return db.task.findMany({
    where: { organizationId, id: { in: theirs }, deletedAt: null, status: { in: [...OPEN] } },
    select: { id: true, title: true },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 25,
  });
}

/** The open to-dos and decisions in every note of the meeting the member can see. */
export async function meetingNoteItems(db: TxClient, organizationId: string, eventId: string) {
  const notes = await db.note.findMany({
    where: { organizationId, eventId, deletedAt: null },
    select: { id: true, contentJson: true },
    orderBy: { createdAt: "asc" },
    take: 10,
  });
  const todos: NoteTodo[] = [];
  const decisions: string[] = [];
  for (const n of notes) {
    const items = noteItems(n.contentJson);
    todos.push(...items.todos);
    decisions.push(...items.decisions);
  }
  return { noteIds: notes.map((n) => n.id), todos, decisions };
}

/** Decisions already linked to the meeting. */
export async function linkedDecisions(db: TxClient, organizationId: string, eventId: string) {
  const links = await db.itemLink.findMany({
    where: {
      organizationId,
      OR: [
        { fromKind: "decision", toKind: "event", toId: eventId },
        { toKind: "decision", fromKind: "event", fromId: eventId },
      ],
    },
    select: { fromKind: true, fromId: true, toId: true },
  });
  const ids = links.map((l) => (l.fromKind === "decision" ? l.fromId : l.toId));
  if (ids.length === 0) return [];
  return db.decision.findMany({
    where: { organizationId, id: { in: ids } },
    select: { question: true, outcome: true },
  });
}

export interface MeetingAmbientFacts {
  /** Open tasks already on this meeting. */
  openTasks: { id: string; title: string }[];
  carryOver: { id: string; title: string }[];
  /** To-dos in the notes that aren't tasks yet. */
  todos: NoteTodo[];
  /** Decisions in the notes not yet logged. */
  decisions: string[];
  /** The first note, for Take notes. */
  noteId: string | null;
  /** Hosts only: guests checked in, plus the session's attendance. */
  checkedIn: number;
  /** Hosts only: when a thank-you went out. */
  thankedAt: Date | null;
}

export async function loadMeetingAmbient(
  db: TxClient,
  organizationId: string,
  event: MeetingRef & { attendanceCount: number },
  linked: { ids: string[]; tasks: { id: string; title: string; status: string }[] },
  canEdit: boolean,
): Promise<MeetingAmbientFacts> {
  const openTasks = linked.tasks
    .filter((t) => t.status !== "COMPLETED")
    .map((t) => ({ id: t.id, title: t.title }));
  const carryOver = await carryOverTasks(db, organizationId, event, linked.ids);
  const notes = await meetingNoteItems(db, organizationId, event.id);
  const todos = todosWithoutTasks(
    notes.todos,
    linked.tasks.map((t) => t.title),
  );
  const decisions = decisionsToLog(
    notes.decisions,
    notes.decisions.length ? await linkedDecisions(db, organizationId, event.id) : [],
  );
  let checkedIn = event.attendanceCount;
  let thankedAt: Date | null = null;
  if (canEdit) {
    checkedIn += await db.eventRegistration.count({
      where: { organizationId, eventId: event.id, checkedInAt: { not: null } },
    });
    // Hosts are owners and admins, who read the audit log.
    const thanked = await db.orgAuditLog.findFirst({
      where: { organizationId, action: "event.thank_you_sent", targetId: event.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    thankedAt = thanked?.createdAt ?? null;
  }
  return {
    openTasks,
    carryOver,
    todos,
    decisions,
    noteId: notes.noteIds[0] ?? null,
    checkedIn,
    thankedAt,
  };
}
