import { Prisma, TaskStatus, TaskType, TaskVisibility } from "@/generated/prisma/client";
import { OPEN_STATUSES } from "@/lib/tasks/status";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";
import { everyWord } from "@/server/search/where";

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
  type: true,
  title: true,
  description: true,
  status: true,
  visibility: true,
  priority: true,
  dueDate: true,
  startDate: true,
  rank: true,
  parentTaskId: true,
  color: true,
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
      type: true,
      status: true,
      visibility: true,
      dueDate: true,
      ownerId: true,
      version: true,
      owner: { select: userPublicSelect },
      // An epic's stories carry their own tasks: the roll-up counts them.
      subtasks: {
        where: { deletedAt: null },
        select: { id: true, status: true },
      },
    },
    orderBy: { rank: "asc" },
  },
  // Two levels up: a task under a story still knows its epic (epicOf).
  parentTask: {
    select: {
      id: true,
      title: true,
      type: true,
      color: true,
      parentTask: { select: { id: true, title: true, type: true, color: true } },
    },
  },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} satisfies Prisma.TaskSelect;

export type TaskListItem = Prisma.TaskGetPayload<{ select: typeof taskListSelect }>;

const live = (organizationId: string) => ({ organizationId, deletedAt: null });

/**
 * A card on the board: a story or a task, at the top or inside an epic. An
 * epic is the swimlane, not a card, and a story's own tasks count on its
 * card. A club that never makes epics gets exactly the old board: every
 * top-level task.
 */
export const BOARD_ITEM = {
  type: { not: TaskType.EPIC },
  OR: [{ parentTaskId: null }, { parentTask: { is: { type: TaskType.EPIC } } }],
} satisfies Prisma.TaskWhereInput;

/** Board: its cards; Completed limited to those done since `completedSince`. */
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
    where: {
      AND: [taskFilterWhere(organizationId, filters, opts.today), BOARD_ITEM, openOrRecent],
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
  filters: TaskFilters,
  completedBefore: Date,
  today?: Date,
) {
  return db.task.count({
    where: {
      AND: [
        taskFilterWhere(organizationId, filters, today),
        BOARD_ITEM,
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
 * The overview's "My tasks": open tasks the viewer owns or is on (subtasks
 * included, as in the Week), soonest due first, with how many there are in
 * all and how many are past due.
 */
export async function getMyOpenTasks(
  db: TxClient,
  organizationId: string,
  userId: string,
  opts: { limit: number; today: Date },
) {
  const mine = taskFilterWhere(organizationId, { assigneeId: userId, status: "open" });
  const tasks = await db.task.findMany({
    where: mine,
    select: {
      id: true,
      title: true,
      status: true,
      visibility: true,
      dueDate: true,
      blockedReason: true,
      parentTask: {
        select: {
          id: true,
          title: true,
          type: true,
          color: true,
          parentTask: { select: { id: true, title: true, type: true, color: true } },
        },
      },
    },
    orderBy: [
      { dueDate: { sort: "asc", nulls: "last" } },
      { priority: "desc" },
      { createdAt: "asc" },
    ],
    take: opts.limit,
  });
  const total = await db.task.count({ where: mine });
  const overdue = await db.task.count({ where: { AND: [mine, { dueDate: { lt: opts.today } }] } });
  return { tasks, total, overdue };
}

export type MyOpenTask = Awaited<ReturnType<typeof getMyOpenTasks>>["tasks"][number];

/**
 * One filter set for every layout (C4). Week, Board, Table, Calendar and
 * Team all read the same toolbar, so the same `where` builds all five and
 * switching layout never silently changes what you are looking at.
 */
export interface TaskFilters {
  /** One epic's work: the epic, its stories and their tasks (?epic=). */
  epicId?: string;
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
  /**
   * Open and due before today: exactly what the Overdue stat counts, so
   * pressing it shows the same number of tasks it said. (It used to turn on
   * `blockers`, which also takes in blocked work, so the list never matched.)
   */
  overdue?: boolean;
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
  if (f.epicId) {
    and.push({
      OR: [
        { id: f.epicId },
        { parentTaskId: f.epicId },
        { parentTask: { is: { parentTaskId: f.epicId } } },
      ],
    });
  }
  if (f.status === "open") and.push({ status: { in: [...OPEN_STATUSES] } });
  else if (f.status) and.push({ status: f.status });
  if (f.ownerId) and.push({ ownerId: f.ownerId });
  if (f.assigneeId) and.push(involving([f.assigneeId]));
  if (f.peopleIds && f.peopleIds.length > 0) and.push(involving(f.peopleIds));
  if (f.visibility) and.push({ visibility: f.visibility });
  if (f.labelId) and.push({ labels: { some: { labelId: f.labelId } } });
  // Every word, in the title or the description (as the ⌘K palette finds them).
  const words = everyWord<Prisma.TaskWhereInput>(f.q, (c) => [{ title: c }, { description: c }]);
  if (words) and.push(words);
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
  if (f.overdue && today) {
    and.push({ status: { in: [...OPEN_STATUSES] }, dueDate: { lt: today } });
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

/**
 * The table and the dashboard count what the board shows: stories and
 * tasks at the top or straight inside an epic (a story's own tasks ride
 * with it, and an epic is a heading, not a row).
 */
export function tableWhere(
  organizationId: string,
  f: TaskFilters,
  today?: Date,
): Prisma.TaskWhereInput {
  return { AND: [taskFilterWhere(organizationId, f, today), BOARD_ITEM] };
}

/** True when anything beyond the epic picker is narrowing the view. */
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
    f.overdue ||
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

/** What every epic picker, filter and chip needs. */
export const epicOptionSelect = {
  id: true,
  title: true,
  type: true,
  color: true,
  status: true,
  ownerId: true,
  startDate: true,
  dueDate: true,
  visibility: true,
  parentTaskId: true,
} satisfies Prisma.TaskSelect;

/**
 * The club's live epics and stories, by title: what a task can be part of
 * (the editor's Part of), and the epics for the toolbar's Epic filter and
 * the board's lanes. Done ones last.
 */
export function getOrgParents(db: TxClient, organizationId: string) {
  return db.task.findMany({
    where: { ...live(organizationId), type: { in: [TaskType.EPIC, TaskType.STORY] } },
    select: epicOptionSelect,
    orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { title: "asc" }],
    take: 1000,
  });
}

/** An epic or a story, as the pickers list it. */
export type ParentOption = Awaited<ReturnType<typeof getOrgParents>>[number];

/**
 * The Epics page: every live epic with its owner, its stories and tasks
 * counted open and done (what the viewer can see; RLS hides private work
 * they aren't on), the next due date among them, and how many are overdue.
 */
export async function getEpicsOverview(db: TxClient, organizationId: string, today: Date) {
  const epics = await db.task.findMany({
    where: { ...live(organizationId), type: TaskType.EPIC },
    select: {
      ...epicOptionSelect,
      description: true,
      createdAt: true,
      completedAt: true,
      owner: { select: userPublicSelect },
      subtasks: {
        where: { deletedAt: null },
        select: {
          type: true,
          status: true,
          dueDate: true,
          subtasks: { where: { deletedAt: null }, select: { status: true, dueDate: true } },
        },
      },
    },
    orderBy: [
      { completedAt: { sort: "asc", nulls: "first" } },
      { dueDate: { sort: "asc", nulls: "last" } },
      { title: "asc" },
    ],
    take: 500,
  });
  return epics.map(({ subtasks, ...e }) => {
    const work = subtasks.flatMap((s) => [s, ...s.subtasks]);
    const done = work.filter((w) => w.status === TaskStatus.COMPLETED).length;
    const overdue = work.filter(
      (w) => w.status !== TaskStatus.COMPLETED && w.dueDate !== null && w.dueDate < today,
    ).length;
    return {
      ...e,
      stories: subtasks.filter((x) => x.type === TaskType.STORY).length,
      open: work.length - done,
      done,
      overdue,
    };
  });
}

export type EpicOverviewItem = Awaited<ReturnType<typeof getEpicsOverview>>[number];

/**
 * The Roadmap: the club's epics (filtered like every layout) with what the
 * timeline needs. A bar starts at the epic's start date; without one, when
 * the epic was made or at its earliest dated piece of work, whichever is
 * first. It ends at its due date or its latest dated piece of work.
 */
export async function getRoadmapEpics(
  db: TxClient,
  organizationId: string,
  filters: TaskFilters,
  today?: Date,
) {
  const epics = await db.task.findMany({
    where: { AND: [taskFilterWhere(organizationId, filters, today), { type: TaskType.EPIC }] },
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      startDate: true,
      color: true,
      createdAt: true,
      completedAt: true,
      owner: { select: userPublicSelect },
      subtasks: {
        where: { deletedAt: null },
        select: {
          status: true,
          dueDate: true,
          subtasks: { where: { deletedAt: null }, select: { status: true, dueDate: true } },
        },
      },
    },
    orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 200,
  });
  return epics.map((e) => {
    const dated = e.subtasks.flatMap((s) => [s.dueDate, ...s.subtasks.map((g) => g.dueDate)]);
    const keys = dated
      .filter((d): d is Date => d !== null)
      .map((d) => d.toISOString().slice(0, 10));
    const created = e.createdAt.toISOString().slice(0, 10);
    const due = e.dueDate ? e.dueDate.toISOString().slice(0, 10) : null;
    const start = e.startDate
      ? e.startDate.toISOString().slice(0, 10)
      : [created, ...keys].sort()[0]!;
    const end = due ?? (keys.length > 0 ? keys.sort()[keys.length - 1]! : null);
    let done = 0;
    let total = 0;
    for (const s of e.subtasks) {
      total += 1 + s.subtasks.length;
      done +=
        (s.status === TaskStatus.COMPLETED ? 1 : 0) +
        s.subtasks.filter((g) => g.status === TaskStatus.COMPLETED).length;
    }
    return {
      id: e.id,
      title: e.title,
      status: e.status,
      color: e.color,
      owner: e.owner,
      start: end && end < start ? end : start,
      end,
      done,
      total,
    };
  });
}

export type RoadmapEpic = Awaited<ReturnType<typeof getRoadmapEpics>>[number];

/**
 * The stat strip over every layout: open, due this week (today to Sunday),
 * overdue and done this week (since Monday), for the toolbar's question
 * without its status filter. Epics are left out: their work is counted.
 */
export async function getTaskStats(
  db: TxClient,
  organizationId: string,
  filters: TaskFilters,
  opts: { today: Date; weekEnd: Date; weekStart: Date },
) {
  const base: Prisma.TaskWhereInput = {
    AND: [
      taskFilterWhere(organizationId, { ...filters, status: undefined }, opts.today),
      { type: { not: TaskType.EPIC } },
    ],
  };
  const open = { status: { in: [...OPEN_STATUSES] } };
  const [openCount, dueThisWeek, overdue, doneThisWeek] = [
    await db.task.count({ where: { AND: [base, open] } }),
    await db.task.count({
      where: { AND: [base, open, { dueDate: { gte: opts.today, lte: opts.weekEnd } }] },
    }),
    await db.task.count({ where: { AND: [base, open, { dueDate: { lt: opts.today } }] } }),
    await db.task.count({
      where: {
        AND: [base, { status: TaskStatus.COMPLETED, completedAt: { gte: opts.weekStart } }],
      },
    }),
  ];
  return { open: openCount, dueThisWeek, overdue, doneThisWeek };
}

export type TaskStats = Awaited<ReturnType<typeof getTaskStats>>;
