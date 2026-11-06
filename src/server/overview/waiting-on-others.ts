import {
  buildWaitingOnOthers,
  type OthersAsk,
  type OthersFacts,
  type WaitingOnOthers,
} from "@/lib/overview/waiting-on-others-text";
import { epicOf, epicParentsSelect } from "@/lib/tasks/epic";
import { dueDateKey, localDateKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

import { linkedTo } from "./item-links";

/**
 * Waiting on others (Overview, offered in Add widget): open tasks the
 * viewer made and handed to someone else, and mentions they made in the
 * last 30 days that the person hasn't answered with a comment. Whether the
 * other person has moved on it is what the workspace can show: a change or
 * a comment of theirs on the task since the ask (who has read a
 * notification is private to them, so "seen" isn't knowable). Read as the
 * member, one query at a time.
 */

const LIMIT = 8;
const MENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const OPEN = ["NOT_STARTED", "IN_PROGRESS", "BLOCKED"] as const;

export interface OthersInput {
  orgId: string;
  orgSlug: string;
  userId: string;
  timeZone: string;
  now: Date;
}

export async function loadWaitingOnOthers(
  db: TxClient,
  input: OthersInput,
): Promise<WaitingOnOthers> {
  return buildWaitingOnOthers(await loadOthersFacts(db, input));
}

export async function loadOthersFacts(db: TxClient, input: OthersInput): Promise<OthersFacts> {
  const { orgId: organizationId, userId: me, now } = input;
  const base = `/app/${input.orgSlug}`;

  const handed = await db.task.findMany({
    where: {
      organizationId,
      deletedAt: null,
      createdById: me,
      status: { in: [...OPEN] },
      ownerId: { not: null },
      NOT: { ownerId: me },
    },
    select: { ...epicParentsSelect, dueDate: true, createdAt: true, ownerId: true },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 20,
  });
  // When the viewer handed each one over (their last ASSIGNED of the owner).
  const handings = handed.length
    ? await db.taskActivity.findMany({
        where: {
          organizationId,
          type: "ASSIGNED",
          actorId: me,
          taskId: { in: handed.map((t) => t.id) },
        },
        select: { taskId: true, diffJson: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      })
    : [];

  const mentions = await db.taskMention.findMany({
    where: {
      organizationId,
      mentionedById: me,
      mentionedUserId: { not: me },
      createdAt: { gt: new Date(now.getTime() - MENTION_DAYS * DAY_MS) },
      task: { deletedAt: null },
    },
    select: { id: true, taskId: true, mentionedUserId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  const taskIds = [...new Set([...handed.map((t) => t.id), ...mentions.map((m) => m.taskId)])];
  // What each person did on these tasks: changes and comments, newest first.
  const people = [
    ...new Set([...handed.map((t) => t.ownerId!), ...mentions.map((m) => m.mentionedUserId)]),
  ];
  const acts = taskIds.length
    ? await db.taskActivity.findMany({
        where: { organizationId, taskId: { in: taskIds }, actorId: { in: people } },
        select: { taskId: true, actorId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      })
    : [];
  const replies = taskIds.length
    ? await db.taskComment.findMany({
        where: {
          organizationId,
          deletedAt: null,
          taskId: { in: taskIds },
          authorId: { in: people },
        },
        select: { taskId: true, authorId: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      })
    : [];
  const lastMove = (taskId: string, userId: string): Date | null => {
    const a = acts.find((x) => x.taskId === taskId && x.actorId === userId)?.createdAt ?? null;
    const c = replies.find((x) => x.taskId === taskId && x.authorId === userId)?.createdAt ?? null;
    return a && c ? (a > c ? a : c) : (a ?? c);
  };
  const lastReply = (taskId: string, userId: string) =>
    replies.find((x) => x.taskId === taskId && x.authorId === userId)?.createdAt ?? null;

  const faces = people.length
    ? await db.user.findMany({ where: { id: { in: people } }, select: userPublicSelect })
    : [];
  const mentionTasks = mentions.length
    ? await db.task.findMany({
        where: {
          organizationId,
          deletedAt: null,
          id: { in: [...new Set(mentions.map((m) => m.taskId))] },
        },
        select: { id: true, title: true, status: true },
      })
    : [];
  const taskEvents = await linkedTo(db, organizationId, "task", taskIds, "event");
  const eventIds = [...new Set([...taskEvents.values()].flat())];
  const events = eventIds.length
    ? await db.event.findMany({
        where: { organizationId, deletedAt: null, id: { in: eventIds } },
        select: { id: true, title: true },
      })
    : [];
  const eventOf = (taskId: string) =>
    (taskEvents.get(taskId) ?? []).map((id) => events.find((e) => e.id === id)).find(Boolean) ??
    null;
  const face = (id: string) => faces.find((f) => f.id === id) ?? null;

  const asks: OthersAsk[] = [];
  for (const t of handed) {
    const person = face(t.ownerId!);
    if (!person) continue;
    const handing = handings.find(
      (h) => h.taskId === t.id && (h.diffJson as { userId?: string } | null)?.userId === t.ownerId,
    );
    const askedAt = handing?.createdAt ?? t.createdAt;
    const moved = lastMove(t.id, t.ownerId!);
    const epic = epicOf(t);
    asks.push({
      kind: "task",
      id: t.id,
      taskId: t.id,
      title: t.title,
      person,
      askedAt,
      dueKey: t.dueDate ? dueDateKey(t.dueDate) : null,
      movedSince: moved !== null && moved > askedAt,
      epic: epic && epic.id !== t.id ? { id: epic.id, title: epic.title } : null,
      event: eventOf(t.id),
    });
  }
  for (const m of mentions) {
    const task = mentionTasks.find((t) => t.id === m.taskId);
    const person = face(m.mentionedUserId);
    // Answered (a comment after the mention), finished, or already listed.
    if (!task || !person || task.status === "COMPLETED") continue;
    const reply = lastReply(m.taskId, m.mentionedUserId);
    if (reply && reply > m.createdAt) continue;
    if (asks.some((a) => a.taskId === m.taskId && a.person.id === person.id)) continue;
    asks.push({
      kind: "mention",
      id: m.id,
      taskId: m.taskId,
      title: task.title,
      person,
      askedAt: m.createdAt,
      dueKey: null,
      movedSince: false,
      epic: null,
      event: eventOf(m.taskId),
    });
  }

  return {
    base,
    todayKey: localDateKey(now, input.timeZone),
    now,
    asks: asks.slice(0, LIMIT),
  };
}
