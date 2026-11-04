import type { Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import {
  buildSince,
  nextVisitStamps,
  sinceLabel,
  type SinceFacts,
  type SinceYouWereHere,
  type Subject,
} from "@/lib/overview/since-text";
import type { PersonFace } from "@/lib/overview/types";
import { epicOf, epicParentsSelect } from "@/lib/tasks/epic";
import { dueDateKey, localDateKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

import { linkedTo } from "./item-links";

/**
 * Since you were here (Overview): the changes since the viewer's previous
 * visit to Home (MemberPrefs.homePrevVisitAt), read as the member, so RLS
 * keeps out anything they can't open. Money for finance roles, and each
 * member's own reimbursements. Every list is bounded; one query at a time.
 */

const LIMIT = 60;

/** A Home view within this long of the last stamp writes nothing (a refresh, a redirect back). */
const RESTAMP_MS = 60_000;

/**
 * Records a visit to Home: when the last one is more than half an hour old
 * it becomes the previous visit, and this one is the last. Returns the
 * previous visit, the moment "since you were here" counts from (null on a
 * first visit). A view under a minute after the last stamp only reads.
 * Own row only (RLS on MemberPrefs).
 */
export async function markHomeVisit(
  db: TxClient,
  organizationId: string,
  userId: string,
  now: Date,
): Promise<Date | null> {
  const current = await db.memberPrefs.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { homeVisitAt: true, homePrevVisitAt: true },
  });
  const last = current?.homeVisitAt;
  if (last && now.getTime() - last.getTime() >= 0 && now.getTime() - last.getTime() < RESTAMP_MS) {
    return current?.homePrevVisitAt ?? null;
  }
  const next = nextVisitStamps(current, now);
  await db.memberPrefs.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, ...next },
    update: next,
    select: { userId: true },
  });
  return next.homePrevVisitAt;
}

export interface SinceYouWereHereData extends SinceYouWereHere {
  /** The previous visit, as words ("Thursday, 9:40 PM"); null on a first visit. */
  sinceLabel: string | null;
}

export interface SinceInput {
  orgId: string;
  orgSlug: string;
  userId: string;
  role: Role;
  timeZone: string;
  now: Date;
  /** What markHomeVisit returned. */
  since: Date | null;
}

export async function loadSinceYouWereHere(
  db: TxClient,
  input: SinceInput,
): Promise<SinceYouWereHereData> {
  const { since } = input;
  if (!since) return { rows: [], total: 0, insight: null, sinceLabel: null };
  const facts = await loadSinceFacts(db, { ...input, since });
  return { ...buildSince(facts), sinceLabel: sinceLabel(since, input.now, input.timeZone) };
}

export async function loadSinceFacts(
  db: TxClient,
  input: SinceInput & { since: Date },
): Promise<SinceFacts> {
  const { orgId: organizationId, userId: me, since } = input;
  const base = `/app/${input.orgSlug}`;
  const after = { gt: since };

  // Work handed to the viewer, and tasks others finished.
  const assignedActs = await db.taskActivity.findMany({
    where: {
      organizationId,
      type: "ASSIGNED",
      createdAt: after,
      actorId: { not: me },
      diffJson: { path: ["userId"], equals: me },
    },
    select: { taskId: true, diffJson: true, createdAt: true, actor: { select: userPublicSelect } },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });
  const finishedActs = await db.taskActivity.findMany({
    where: {
      organizationId,
      type: "STATUS_CHANGED",
      createdAt: after,
      actorId: { not: me },
      diffJson: { path: ["to"], equals: "COMPLETED" },
    },
    select: { taskId: true, createdAt: true, actor: { select: userPublicSelect } },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });
  // Mentions of the viewer, from their own notifications.
  const mentionRows = await db.notification.findMany({
    where: {
      organizationId,
      userId: me,
      type: "TASK_MENTIONED",
      createdAt: after,
      taskId: { not: null },
    },
    select: { taskId: true, actor: { select: userPublicSelect } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  // Comments others left on tasks the viewer owns or made.
  const commentRows = await db.taskComment.findMany({
    where: {
      organizationId,
      deletedAt: null,
      createdAt: after,
      authorId: { not: me },
      task: { deletedAt: null, OR: [{ ownerId: me }, { createdById: me }] },
    },
    select: { taskId: true, author: { select: userPublicSelect } },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });

  const taskIds = [
    ...new Set([
      ...assignedActs.map((a) => a.taskId),
      ...finishedActs.map((a) => a.taskId),
      ...mentionRows.flatMap((m) => (m.taskId ? [m.taskId] : [])),
      ...commentRows.map((c) => c.taskId),
    ]),
  ];
  // Visible tasks only (RLS), with their epic and linked event.
  const tasks = taskIds.length
    ? await db.task.findMany({
        where: { organizationId, deletedAt: null, id: { in: taskIds } },
        select: { ...epicParentsSelect, status: true, dueDate: true },
      })
    : [];
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const taskEvents = await linkedTo(db, organizationId, "task", [...taskById.keys()], "event");
  const noteRows = await db.note.findMany({
    where: {
      organizationId,
      deletedAt: null,
      updatedAt: after,
      updatedById: { not: me },
    },
    select: {
      id: true,
      title: true,
      createdAt: true,
      authorId: true,
      eventId: true,
      updatedBy: { select: userPublicSelect },
    },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  // New comments on notes: on the ones above, and on the viewer's own notes.
  const noteComments = await db.noteComment.findMany({
    where: {
      organizationId,
      createdAt: after,
      authorId: { not: me },
      OR: [
        { noteId: { in: noteRows.map((n) => n.id) } },
        { note: { authorId: me, deletedAt: null } },
      ],
    },
    select: { noteId: true, author: { select: userPublicSelect } },
    take: 200,
  });
  const commentedOnly = [...new Set(noteComments.map((c) => c.noteId))].filter(
    (id) => !noteRows.some((n) => n.id === id),
  );
  const commentedNotes = commentedOnly.length
    ? await db.note.findMany({
        where: { organizationId, deletedAt: null, id: { in: commentedOnly } },
        select: { id: true, title: true, authorId: true, eventId: true },
      })
    : [];

  const eventIds = [
    ...new Set([
      ...[...taskEvents.values()].flat(),
      ...noteRows.flatMap((n) => (n.eventId ? [n.eventId] : [])),
      ...commentedNotes.flatMap((n) => (n.eventId ? [n.eventId] : [])),
    ]),
  ];

  // People who joined, and the next event most of them said yes to.
  const joinedRows = await db.membership.findMany({
    where: { organizationId, joinedAt: after, userId: { not: me } },
    select: { user: { select: userPublicSelect } },
    orderBy: { joinedAt: "asc" },
    take: 40,
  });
  const joinedIds = joinedRows.map((j) => j.user.id);
  const theirRsvps = joinedIds.length
    ? await db.eventAttendee.findMany({
        where: {
          organizationId,
          userId: { in: joinedIds },
          rsvp: "YES",
          event: { deletedAt: null, startsAt: { gt: input.now } },
        },
        select: { eventId: true },
        take: 200,
      })
    : [];
  const goingCount = new Map<string, number>();
  for (const r of theirRsvps) goingCount.set(r.eventId, (goingCount.get(r.eventId) ?? 0) + 1);
  const topGoing = [...goingCount.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topGoing) eventIds.push(topGoing[0]);

  // Money: finance sees requests and decisions; everyone sees what
  // happened to their own requests.
  const seesMoney = can({ role: input.role }, "finance.manage");
  const moneyRows = await db.transaction.findMany({
    where: {
      organizationId,
      voidedAt: null,
      kind: "EXPENSE",
      OR: [
        ...(seesMoney
          ? [{ createdAt: after, status: "SUBMITTED" as const, submittedById: { not: me } }]
          : []),
        {
          submittedById: me,
          OR: [
            { approvedAt: after },
            { reimbursedAt: after },
            { status: "REJECTED" as const, updatedAt: after },
          ],
        },
      ],
    },
    select: {
      id: true,
      description: true,
      amountCents: true,
      status: true,
      submittedById: true,
      approvedById: true,
      approvedAt: true,
      reimbursedAt: true,
      categoryId: true,
      eventId: true,
      submittedBy: { select: userPublicSelect },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const receipts = moneyRows.length
    ? await db.receipt.groupBy({
        by: ["transactionId"],
        where: { organizationId, transactionId: { in: moneyRows.map((m) => m.id) } },
        _count: { _all: true },
      })
    : [];
  const categoryIds = [...new Set(moneyRows.flatMap((m) => (m.categoryId ? [m.categoryId] : [])))];
  const categories = categoryIds.length
    ? await db.budgetCategory.findMany({
        where: { organizationId, id: { in: categoryIds } },
        select: { id: true, name: true, budgetPeriodId: true },
      })
    : [];
  // Who decided on the viewer's own requests.
  const deciderIds = [
    ...new Set(
      moneyRows.flatMap((m) => (m.submittedById === me && m.approvedById ? [m.approvedById] : [])),
    ),
  ];
  const deciders = deciderIds.length
    ? await db.user.findMany({ where: { id: { in: deciderIds } }, select: userPublicSelect })
    : [];
  for (const m of moneyRows) if (m.eventId) eventIds.push(m.eventId);

  const events = eventIds.length
    ? await db.event.findMany({
        where: { organizationId, deletedAt: null, id: { in: [...new Set(eventIds)] } },
        select: { id: true, title: true },
      })
    : [];
  const eventById = new Map(events.map((e) => [e.id, e]));

  const taskRef = (taskId: string) => {
    const t = taskById.get(taskId);
    if (!t) return null;
    const epic = epicOf(t);
    const linked = (taskEvents.get(taskId) ?? [])
      .map((id) => eventById.get(id))
      .filter(Boolean) as {
      id: string;
      title: string;
    }[];
    const subjects: Subject[] = [
      ...(epic && epic.id !== t.id ? [{ key: `task:${epic.id}`, title: epic.title }] : []),
      ...linked.map((e) => ({ key: `event:${e.id}`, title: e.title })),
    ];
    return {
      taskId,
      title: t.title,
      subjects,
      event: linked[0] ?? null,
      epic: epic && epic.id !== t.id ? { id: epic.id, title: epic.title } : null,
      dueKey: t.dueDate ? dueDateKey(t.dueDate) : null,
    };
  };

  const assigned: SinceFacts["assigned"] = [];
  for (const a of assignedActs) {
    const ref = taskRef(a.taskId);
    if (!ref || !a.actor || assigned.some((x) => x.taskId === a.taskId)) continue;
    const role =
      (a.diffJson as { role?: string } | null)?.role === "owner" ? "owner" : "collaborator";
    assigned.push({ ...ref, actor: a.actor, role });
  }
  const finished: SinceFacts["finished"] = [];
  for (const a of finishedActs) {
    const ref = taskRef(a.taskId);
    // Still finished (not reopened since), and once per task.
    if (!ref || !a.actor || taskById.get(a.taskId)?.status !== "COMPLETED") continue;
    if (finished.some((x) => x.taskId === a.taskId)) continue;
    finished.push({ ...ref, actor: a.actor });
  }
  const mentions: SinceFacts["mentions"] = [];
  for (const m of mentionRows) {
    const ref = m.taskId ? taskRef(m.taskId) : null;
    if (!ref || !m.actor) continue;
    if (mentions.some((x) => x.taskId === ref.taskId && x.actor.id === m.actor!.id)) continue;
    mentions.push({ ...ref, actor: m.actor });
  }
  const comments: SinceFacts["comments"] = [];
  for (const c of commentRows) {
    const ref = taskRef(c.taskId);
    if (!ref) continue;
    const same = comments.find((x) => x.taskId === c.taskId && x.actor.id === c.author.id);
    if (same) same.count += 1;
    else comments.push({ ...ref, actor: c.author, count: 1 });
  }

  const commentsOn = new Map<string, number>();
  const commenter = new Map<string, PersonFace>();
  for (const c of noteComments) {
    commentsOn.set(c.noteId, (commentsOn.get(c.noteId) ?? 0) + 1);
    if (c.author && !commenter.has(c.noteId)) commenter.set(c.noteId, c.author);
  }
  const notes: SinceFacts["notes"] = [
    ...noteRows.map((n) => ({
      noteId: n.id,
      title: n.title || "Untitled",
      actor: n.updatedBy,
      created: n.createdAt > since,
      comments: commentsOn.get(n.id) ?? 0,
      mine: n.authorId === me,
      event: n.eventId ? (eventById.get(n.eventId) ?? null) : null,
    })),
    // A note nobody edited, only commented on: the change is the comments,
    // every one of them, and its first commenter is who it's from.
    ...commentedNotes.flatMap((n) => {
      const actor = commenter.get(n.id);
      return actor
        ? [
            {
              noteId: n.id,
              title: n.title || "Untitled",
              actor,
              created: false,
              commentedOnly: true,
              comments: commentsOn.get(n.id) ?? 1,
              mine: n.authorId === me,
              event: n.eventId ? (eventById.get(n.eventId) ?? null) : null,
            },
          ]
        : [];
    }),
  ];

  const deciderById = new Map(deciders.map((d) => [d.id, d]));
  const money: SinceFacts["money"] = moneyRows.flatMap((m) => {
    const mine = m.submittedById === me;
    const change: SinceFacts["money"][number]["change"] = !mine
      ? "submitted"
      : m.status === "REJECTED"
        ? "declined"
        : m.reimbursedAt && m.reimbursedAt > since
          ? "paid"
          : "approved";
    const actor = mine
      ? m.approvedById
        ? deciderById.get(m.approvedById)
        : undefined
      : m.submittedBy;
    if (!actor) return [];
    const category = categories.find((c) => c.id === m.categoryId);
    return [
      {
        id: m.id,
        description: m.description,
        amountCents: m.amountCents,
        actor,
        change,
        mine,
        receipts: receipts.find((r) => r.transactionId === m.id)?._count._all ?? 0,
        category: category
          ? { id: category.id, name: category.name, periodId: category.budgetPeriodId }
          : null,
        event: m.eventId ? (eventById.get(m.eventId) ?? null) : null,
      },
    ];
  });

  return {
    base,
    todayKey: localDateKey(input.now, input.timeZone),
    assigned,
    mentions,
    finished,
    comments,
    notes,
    joined: {
      people: joinedRows.map((j) => j.user),
      goingTo:
        topGoing && eventById.get(topGoing[0])
          ? { ...eventById.get(topGoing[0])!, count: topGoing[1] }
          : null,
    },
    money,
  };
}
