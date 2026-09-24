import { NotificationType, Prisma, TaskStatus } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { addDaysToKey, dueDateKey, formatDueKey, fromDateKey, mondayOfKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";
import { computeReportingSubtree } from "@/server/org-chart/queries";

import { loadChartNodes } from "./assignment-policy";
import type { DigestItem, DigestSections } from "./email-templates";

/**
 * The daily digest's content for one member, computed in SQL at send time
 * (the task-digest job and the email renderer both call it): overdue, due
 * today, due this week, newly assigned or mentioned in the last 24 hours,
 * and blocked items they own or manage (a BLOCKED task owned by someone in
 * their reporting subtree). Task data only; never database rows.
 */

const digestSelect = {
  id: true,
  title: true,
  dueDate: true,
  blockedReason: true,
  owner: { select: { name: true } },
} satisfies Prisma.TaskSelect;

export async function loadDigest(
  db: TxClient,
  input: { organizationId: string; orgSlug: string; userId: string; now: Date; todayKey: string },
): Promise<DigestSections> {
  const { organizationId, userId, now, todayKey } = input;
  const link = (id: string) => appUrl(`/app/${input.orgSlug}/tasks/${id}`);
  const item = (
    t: Prisma.TaskGetPayload<{ select: typeof digestSelect }>,
    note?: string | null,
  ): DigestItem => ({
    title: t.title,
    dueLabel: t.dueDate ? formatDueKey(dueDateKey(t.dueDate), todayKey) : null,
    url: link(t.id),
    note: note ?? null,
  });

  const mine: Prisma.TaskWhereInput = {
    organizationId,
    deletedAt: null,
    OR: [{ ownerId: userId }, { assignees: { some: { userId } } }],
  };
  const working = { in: [TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS] };
  const today = fromDateKey(todayKey);
  const sunday = fromDateKey(addDaysToKey(mondayOfKey(todayKey), 6));

  const overdue = await db.task.findMany({
    where: { AND: [mine, { status: working, dueDate: { lt: today } }] },
    select: digestSelect,
    orderBy: { dueDate: "asc" },
    take: 25,
  });
  const dueToday = await db.task.findMany({
    where: { AND: [mine, { status: working, dueDate: today }] },
    select: digestSelect,
    take: 25,
  });
  const thisWeek = await db.task.findMany({
    where: { AND: [mine, { status: working, dueDate: { gt: today, lte: sunday } }] },
    select: digestSelect,
    orderBy: { dueDate: "asc" },
    take: 25,
  });

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const recent = await db.notification.findMany({
    where: {
      organizationId,
      userId,
      createdAt: { gte: since },
      taskId: { not: null },
      type: { in: [NotificationType.TASK_ASSIGNED, NotificationType.TASK_FLAGGED, NotificationType.TASK_MENTIONED] },
    },
    select: { type: true, taskId: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const assignedIds = [
    ...new Set(recent.filter((r) => r.type !== NotificationType.TASK_MENTIONED).map((r) => r.taskId as string)),
  ];
  const mentionedIds = [
    ...new Set(recent.filter((r) => r.type === NotificationType.TASK_MENTIONED).map((r) => r.taskId as string)),
  ];
  const recentTasks = await db.task.findMany({
    where: {
      organizationId,
      deletedAt: null,
      id: { in: [...assignedIds, ...mentionedIds] },
      status: { not: TaskStatus.COMPLETED },
    },
    select: digestSelect,
  });
  const byId = new Map(recentTasks.map((t) => [t.id, t]));

  // Blocked items they own, plus (6b) blocked items owned by their reports.
  const chart = await loadChartNodes(db, organizationId);
  const reports = chart ? computeReportingSubtree(chart, userId).userIds : [];
  const blocked = await db.task.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: TaskStatus.BLOCKED,
      ownerId: { in: [userId, ...reports] },
    },
    select: digestSelect,
    orderBy: { blockedAt: "asc" },
    take: 25,
  });

  return {
    overdue: overdue.map((t) => item(t)),
    today: dueToday.map((t) => item(t)),
    thisWeek: thisWeek.map((t) => item(t)),
    newlyAssigned: assignedIds.flatMap((id) => (byId.has(id) ? [item(byId.get(id)!)] : [])),
    mentioned: mentionedIds.flatMap((id) => (byId.has(id) ? [item(byId.get(id)!)] : [])),
    blocked: blocked.map((t) =>
      item(t, [t.blockedReason, t.owner?.name && reports.length > 0 ? `owner: ${t.owner.name}` : null].filter(Boolean).join(" · ")),
    ),
  };
}
