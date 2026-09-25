import { Prisma, TaskStatus, TaskVisibility } from "@/generated/prisma/client";
import { OPEN_STATUSES } from "@/lib/tasks/status";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

/**
 * Task reads for the tasks pages. Every function takes the page's ctx.db
 * (withOrgTx), so RLS scopes them to the viewer's org, and still filters on
 * organizationId explicitly. People are always userPublicSelect (no emails).
 *
 * C4 visibility needs NO filter in this file. These queries run as app_user,
 * where the SELECT policy on Task already hides a private task the viewer is
 * not on — and hides its comments, mentions, activity, collaborators and
 * labels with it, including through a relation (an invisible parent comes
 * back as `parentTask: null`, so a subtask's breadcrumb cannot leak a title).
 * `TableFilters.visibility` below is a user-facing filter, not a guard.
 */

export const taskListSelect = {
  id: true,
  organizationId: true,
  title: true,
  description: true,
  status: true,
  visibility: true,
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
      visibility: true,
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
  filters: TaskFilters,
  opts: { completedSince?: Date | null; today?: Date } = {},
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
    where: { AND: [tableWhere(organizationId, filters, opts.today), openOrRecent] },
    select: taskListSelect,
    // Rank is a fractional-index sequence per status column: group by status first.
    orderBy: [{ status: "asc" }, { rank: "asc" }],
    take: 1000,
  });
}

export function countOlderCompleted(
  db: TxClient,
  organizationId: string,
  filters: TaskFilters,
  completedBefore: Date,
  today?: Date,
) {
  return db.task.count({
    where: {
      AND: [
        tableWhere(organizationId, filters, today),
        { status: TaskStatus.COMPLETED },
        { OR: [{ completedAt: { lt: completedBefore } }, { completedAt: null }] },
      ],
    },
  });
}

/**
 * The Week agenda: open tasks (subtasks included, so a handed-down piece of
 * work shows up in the week of whoever owns it), plus what was finished
 * since `completedSince`. The caller groups them by due date.
 */
export async function getAgendaTasks(
  db: TxClient,
  organizationId: string,
  filters: TaskFilters,
  opts: { completedSince: Date; limit: number; today?: Date },
) {
  const base = taskFilterWhere(organizationId, filters, opts.today);
  const open = await db.task.findMany({
    where: { AND: [base, { status: { in: [...OPEN_STATUSES] } }] },
    select: taskListSelect,
    orderBy: [
      { dueDate: { sort: "asc", nulls: "last" } },
      { priority: "desc" },
      { createdAt: "asc" },
    ],
    take: opts.limit + 1,
  });
  const completed = await db.task.findMany({
    where: {
      AND: [base, { status: TaskStatus.COMPLETED, completedAt: { gte: opts.completedSince } }],
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

/**
 * One filter set for every layout (C4). Week, Board, Table, Calendar and
 * Team all read the same toolbar, so the same `where` builds all five and
 * switching layout never silently changes what you are looking at.
 */
export interface TaskFilters {
  projectId?: string;
  status?: TaskStatus | "open";
  /** Owned by exactly this person (the org-chart panel links ?owner=). */
  ownerId?: string;
  /** Owned by OR involving this person (the People pages link ?assignee=). */
  assigneeId?: string;
  /** Owned by or involving any of these — the Mine / My team scope. */
  peopleIds?: readonly string[];
  labelId?: string;
  q?: string;
  dueFrom?: Date;
  dueTo?: Date;
  flagged?: boolean;
  blockers?: boolean;
  /** C4: narrow to private tasks, or to the open ones. */
  visibility?: TaskVisibility;
}

/** Kept as the old name for the table's call sites. */
export type TableFilters = TaskFilters;

export const TABLE_PAGE_SIZE = 50;

/** Owned by, or a collaborator on. */
function involving(userIds: readonly string[]): Prisma.TaskWhereInput {
  return userIds.length === 1
    ? { OR: [{ ownerId: userIds[0] }, { assignees: { some: { userId: userIds[0] } } }] }
    : {
        OR: [
          { ownerId: { in: [...userIds] } },
          { assignees: { some: { userId: { in: [...userIds] } } } },
        ],
      };
}

/** The toolbar's filters, without any structural constraint of its own. */
export function taskFilterWhere(
  organizationId: string,
  f: TaskFilters,
  today?: Date,
): Prisma.TaskWhereInput {
  const and: Prisma.TaskWhereInput[] = [live(organizationId)];
  if (f.projectId) and.push({ projectId: f.projectId });
  if (f.status === "open") and.push({ status: { in: [...OPEN_STATUSES] } });
  else if (f.status) and.push({ status: f.status });
  if (f.ownerId) and.push({ ownerId: f.ownerId });
  if (f.assigneeId) and.push(involving([f.assigneeId]));
  if (f.peopleIds && f.peopleIds.length > 0) and.push(involving(f.peopleIds));
  if (f.visibility) and.push({ visibility: f.visibility });
  if (f.labelId) and.push({ labels: { some: { labelId: f.labelId } } });
  if (f.q) and.push({ title: { contains: f.q, mode: "insensitive" } });
  if (f.dueFrom || f.dueTo) {
    and.push({
      dueDate: { ...(f.dueFrom ? { gte: f.dueFrom } : {}), ...(f.dueTo ? { lte: f.dueTo } : {}) },
    });
  }
  if (f.flagged) {
    and.push({
      OR: [
        { ownerFlagged: true },
        { assignees: { some: { flagged: true, flagAcknowledgedAt: null } } },
      ],
    });
  }
  if (f.blockers && today) {
    // The exec-sync agenda: blocked, or open and overdue.
    and.push({
      OR: [
        { status: TaskStatus.BLOCKED },
        {
          status: { in: [TaskStatus.NOT_STARTED, TaskStatus.IN_PROGRESS] },
          dueDate: { lt: today },
        },
      ],
    });
  }
  return { AND: and };
}

/** The table and the board show top-level tasks only. */
export function tableWhere(
  organizationId: string,
  f: TaskFilters,
  today?: Date,
): Prisma.TaskWhereInput {
  return { AND: [taskFilterWhere(organizationId, f, today), { parentTaskId: null }] };
}

/** True when anything beyond the project picker is narrowing the view. */
export function hasActiveFilters(f: TaskFilters): boolean {
  return Boolean(
    f.status ||
    f.ownerId ||
    f.assigneeId ||
    (f.peopleIds && f.peopleIds.length > 0) ||
    f.labelId ||
    f.q ||
    f.dueFrom ||
    f.dueTo ||
    f.flagged ||
    f.blockers ||
    f.visibility,
  );
}

export async function getTableTasks(
  db: TxClient,
  organizationId: string,
  filters: TaskFilters,
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
  filters: TaskFilters,
  today?: Date,
) {
  return db.task.findMany({
    where: taskFilterWhere(organizationId, filters, today),
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
  opts: {
    includeUnowned?: boolean;
    excludeOwners?: readonly string[];
    filters?: TaskFilters;
    today?: Date;
  } = {},
) {
  const or: Prisma.TaskWhereInput[] = [];
  if (ownerIds.length > 0) or.push({ ownerId: { in: [...ownerIds] } });
  if (opts.excludeOwners) or.push({ ownerId: { notIn: [...opts.excludeOwners] } });
  if (opts.includeUnowned) or.push({ ownerId: null });
  if (or.length === 0) return Promise.resolve([]);
  // The lanes are the structure, so the toolbar's own owner/scope filters are
  // dropped here; everything else (project, status, label, search, due,
  // flagged, blockers, visibility) still applies.
  const { ownerId: _o, assigneeId: _a, peopleIds: _p, ...rest } = opts.filters ?? {};
  return db.task.findMany({
    where: {
      AND: [
        taskFilterWhere(organizationId, rest, opts.today),
        { status: { in: [...OPEN_STATUSES] } },
        { OR: or },
      ],
    },
    select: taskListSelect,
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priority: "desc" }],
    take: 1000,
  });
}

/** An intake queue: its open requests and those done since `completedSince`. */
export function getIntakeTasks(
  db: TxClient,
  organizationId: string,
  projectId: string,
  completedSince: Date,
) {
  return db.task.findMany({
    where: {
      ...live(organizationId),
      projectId,
      parentTaskId: null,
      OR: [{ status: { not: TaskStatus.COMPLETED } }, { completedAt: { gte: completedSince } }],
    },
    select: taskListSelect,
    orderBy: [{ createdAt: "asc" }],
    take: 500,
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
