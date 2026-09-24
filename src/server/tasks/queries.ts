import { Prisma, TaskStatus } from "@/generated/prisma/client";
import { OPEN_STATUSES } from "@/lib/tasks/status";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

/**
 * Task reads for the tasks pages. Every function takes the page's ctx.db
 * (withOrgTx), so RLS scopes them to the viewer's org, and still filters on
 * organizationId explicitly. People are always userPublicSelect (no emails).
 */

export const taskListSelect = {
  id: true,
  organizationId: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  rank: true,
  parentTaskId: true,
  projectId: true,
  createdById: true,
  createdAt: true,
  completedAt: true,
  blockedAt: true,
  blockedReason: true,
  version: true,
  ownerId: true,
  ownerRelation: true,
  ownerFlagged: true,
  ownerAssignedById: true,
  owner: { select: userPublicSelect },
  createdBy: { select: userPublicSelect },
  assignees: {
    select: {
      userId: true,
      relation: true,
      flagged: true,
      flagAcknowledgedAt: true,
      assignedById: true,
      user: { select: userPublicSelect },
    },
    orderBy: { assignedAt: "asc" },
  },
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
  subtasks: {
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      ownerId: true,
      version: true,
      owner: { select: userPublicSelect },
    },
    orderBy: { rank: "asc" },
  },
  project: { select: { id: true, name: true, isIntake: true, triageUserId: true } },
  parentTask: { select: { id: true, title: true } },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} satisfies Prisma.TaskSelect;

export type TaskListItem = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>;

const live = (organizationId: string) => ({ organizationId, deletedAt: null });

/** Board: top-level tasks; Completed limited to those done since `completedSince`. */
export function getBoardTasks(
  db: TxClient,
  organizationId: string,
  opts: { projectId?: string; ownerId?: string; completedSince?: Date | null },
) {
  const openOrRecent: Prisma.TaskWhereInput = opts.completedSince
    ? {
        OR: [
          { status: { not: TaskStatus.COMPLETED } },
          { completedAt: { gte: opts.completedSince } },
        ],
      }
    : {};
  return db.task.findMany({
    where: {
      ...live(organizationId),
      parentTaskId: null,
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
      ...openOrRecent,
    },
    select: taskListSelect,
    // Rank is a fractional-index sequence per status column: group by status first.
    orderBy: [{ status: "asc" }, { rank: "asc" }],
    take: 1000,
  });
}

export function countOlderCompleted(
  db: TxClient,
  organizationId: string,
  opts: { projectId?: string; ownerId?: string; completedBefore: Date },
) {
  return db.task.count({
    where: {
      ...live(organizationId),
      parentTaskId: null,
      status: TaskStatus.COMPLETED,
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
      OR: [{ completedAt: { lt: opts.completedBefore } }, { completedAt: null }],
    },
  });
}

/** Tasks the user owns or is involved in (subtasks included). */
function mineWhere(organizationId: string, userId: string): Prisma.TaskWhereInput {
  return {
    ...live(organizationId),
    OR: [{ ownerId: userId }, { assignees: { some: { userId } } }],
  };
}

/** My Tasks: open tasks (owned or involved), plus completions since `completedSince`. */
export async function getMyTasks(
  db: TxClient,
  organizationId: string,
  userId: string,
  opts: { completedSince: Date; limit: number; projectId?: string },
) {
  const base = mineWhere(organizationId, userId);
  const project = opts.projectId ? { projectId: opts.projectId } : {};
  const open = await db.task.findMany({
    where: { AND: [base, project, { status: { in: [...OPEN_STATUSES] } }] },
    select: taskListSelect,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "asc" }],
    take: opts.limit + 1,
  });
  const completed = await db.task.findMany({
    where: {
      AND: [base, project, { status: TaskStatus.COMPLETED, completedAt: { gte: opts.completedSince } }],
    },
    select: taskListSelect,
    orderBy: { completedAt: "desc" },
    take: 50,
  });
  return {
    open: open.slice(0, opts.limit),
    hasMore: open.length > opts.limit,
    completed,
  };
}

export interface TableFilters {
  projectId?: string;
  status?: TaskStatus | "open";
  ownerId?: string;
  assigneeId?: string;
  labelId?: string;
  q?: string;
  dueFrom?: Date;
  dueTo?: Date;
  flagged?: boolean;
  blockers?: boolean;
}

export const TABLE_PAGE_SIZE = 50;

export function tableWhere(organizationId: string, f: TableFilters, today?: Date): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [{ ...live(organizationId), parentTaskId: null }];
  if (f.projectId) and.push({ projectId: f.projectId });
  if (f.status === "open") and.push({ status: { in: [...OPEN_STATUSES] } });
  else if (f.status) and.push({ status: f.status });
  if (f.ownerId) and.push({ ownerId: f.ownerId });
  if (f.assigneeId) and.push({ assignees: { some: { userId: f.assigneeId } } });
  if (f.labelId) and.push({ labels: { some: { labelId: f.labelId } } });
  if (f.q) and.push({ title: { contains: f.q, mode: "insensitive" } });
  if (f.dueFrom || f.dueTo) {
    and.push({ dueDate: { ...(f.dueFrom ? { gte: f.dueFrom } : {}), ...(f.dueTo ? { lte: f.dueTo } : {}) } });
  }
  if (f.flagged) {
    and.push({ OR: [{ ownerFlagged: true }, { assignees: { some: { flagged: true, flagAcknowledgedAt: null } } }] });
  }
  if (f.blockers && today) {
    // The exec-sync agenda: blocked, or open and overdue.
    and.push({
      OR: [
        { status: TaskStatus.BLOCKED },
        { status: { in: [TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS] }, dueDate: { lt: today } },
      ],
    });
  }
  return { AND: and };
}

export async function getTableTasks(
  db: TxClient,
  organizationId: string,
  filters: TableFilters,
  page: number,
  today: Date,
) {
  const where = tableWhere(organizationId, filters, today);
  const total = await db.task.count({ where });
  const tasks = await db.task.findMany({
    where,
    select: taskListSelect,
    orderBy: [{ status: "asc" }, { rank: "asc" }, { id: "asc" }],
    skip: (page - 1) * TABLE_PAGE_SIZE,
    take: TABLE_PAGE_SIZE,
  });
  return { tasks, total };
}

/** Calendar: dated and undated tasks, subtasks included. */
export function getCalendarTasks(
  db: TxClient,
  organizationId: string,
  opts: { projectId?: string; ownerId?: string },
) {
  return db.task.findMany({
    where: {
      ...live(organizationId),
      ...(opts.projectId ? { projectId: opts.projectId } : {}),
      ...(opts.ownerId ? { ownerId: opts.ownerId } : {}),
    },
    select: taskListSelect,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { rank: "asc" }],
    take: 1000,
  });
}

/** Team view: open tasks owned by any of `ownerIds` (or unowned, when asked). */
export function getOpenTasksByOwners(
  db: TxClient,
  organizationId: string,
  ownerIds: readonly string[],
  opts: { includeUnowned?: boolean; excludeOwners?: readonly string[] } = {},
) {
  const or: Prisma.TaskWhereInput[] = [];
  if (ownerIds.length > 0) or.push({ ownerId: { in: [...ownerIds] } });
  if (opts.excludeOwners) or.push({ ownerId: { notIn: [...opts.excludeOwners] } });
  if (opts.includeUnowned) or.push({ ownerId: null });
  if (or.length === 0) return Promise.resolve([]);
  return db.task.findMany({
    where: { ...live(organizationId), status: { in: [...OPEN_STATUSES] }, OR: or },
    select: taskListSelect,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
    take: 1000,
  });
}

export function getTaskDetail(db: TxClient, organizationId: string, taskId: string) {
  return db.task.findFirst({
    where: { id: taskId, ...live(organizationId) },
    select: taskListSelect,
  });
}

export const COMMENTS_PAGE_SIZE = 20;

export const commentSelect = {
  id: true,
  body: true,
  createdAt: true,
  editedAt: true,
  authorId: true,
  author: { select: userPublicSelect },
} satisfies Prisma.TaskCommentSelect;

export type TaskCommentItem = Prisma.TaskCommentGetPayload<{ select: typeof commentSelect }>;

/** A page of comments, oldest first, ending before `before` (a comment id). */
export async function getComments(
  db: TxClient,
  organizationId: string,
  taskId: string,
  opts: { before?: string | null; take?: number } = {},
) {
  const take = opts.take ?? COMMENTS_PAGE_SIZE;
  let cursorDate: Date | undefined;
  if (opts.before) {
    const cursor = await db.taskComment.findFirst({
      where: { id: opts.before, organizationId, taskId },
      select: { createdAt: true },
    });
    cursorDate = cursor?.createdAt;
  }
  const rows = await db.taskComment.findMany({
    where: {
      organizationId,
      taskId,
      deletedAt: null,
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    },
    select: commentSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
  });
  const hasMore = rows.length > take;
  return { comments: rows.slice(0, take).reverse(), hasMore };
}

export function getActivity(db: TxClient, organizationId: string, taskId: string) {
  return db.taskActivity.findMany({
    where: { organizationId, taskId },
    select: {
      id: true,
      type: true,
      diffJson: true,
      createdAt: true,
      actor: { select: userPublicSelect },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export type TaskActivityItem = Awaited<ReturnType<typeof getActivity>>[number];

export function getOrgLabels(db: TxClient, organizationId: string) {
  return db.label.findMany({
    where: { organizationId },
    select: { id: true, name: true, color: true },
    orderBy: { name: "asc" },
  });
}

export function getOrgProjects(db: TxClient, organizationId: string, includeArchived = false) {
  return db.project.findMany({
    where: { organizationId, ...(includeArchived ? {} : { archivedAt: null }) },
    select: {
      id: true,
      name: true,
      isIntake: true,
      triageUserId: true,
      defaultDueInDays: true,
      archivedAt: true,
    },
    orderBy: { name: "asc" },
  });
}

export type ProjectOption = Awaited<ReturnType<typeof getOrgProjects>>[number];
