import "server-only";

import { z } from "zod";

import type { Prisma, TaskPriority, TaskStatus, TaskType } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { fromDateKey } from "@/lib/tasks/dates";
import type { OrgContext } from "@/server/db/context";
import {
  getActivity,
  getComments,
  getTaskDetail,
  taskFilterWhere,
  type TaskFilters,
} from "@/server/tasks/queries";

import { decodeCursor, listFingerprint, pageOf } from "./cursor";
import { itemId, memberOf, refOf, type ItemRef } from "./ids";
import {
  ConnectorInputError,
  cursorArg,
  dayArg,
  itemArg,
  limitArg,
  nextCursor,
  personOf,
  personRef,
  READ_ONLY,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type FetchedItem,
  type ToolRegistrar,
} from "./shared";
import { inSpace, type ToolSpace } from "./space";
import { dayOf, zonedIso } from "./text";

/**
 * list_tasks and get_task (docs/features/ai-connectors.md): the space's
 * tasks as the member sees them. RLS hides a private task they aren't on,
 * with its comments and activity, so nothing here filters for it.
 */

export const TASKS = { feature: "tasks", section: "tasks" } as const;

const STATUS_OUT: Record<TaskStatus, "not_started" | "in_progress" | "blocked" | "done"> = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  BLOCKED: "blocked",
  COMPLETED: "done",
};

const STATUS_IN: Record<string, TaskFilters["status"]> = {
  open: "open",
  not_started: "NOT_STARTED",
  in_progress: "IN_PROGRESS",
  blocked: "BLOCKED",
  done: "COMPLETED",
  any: undefined,
};

const TYPE_OUT: Record<TaskType, "epic" | "story" | "task"> = {
  EPIC: "epic",
  STORY: "story",
  TASK: "task",
};

const PRIORITY_OUT: Record<TaskPriority, "low" | "medium" | "high"> = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
};

const statusField = z.enum(["not_started", "in_progress", "blocked", "done"]);

const partOf = z
  .object({ id: z.string(), title: z.string() })
  .nullable()
  .describe("The epic or story it's part of.");

export const taskSummary = z.object({
  id: z.string().describe("The task's id, for get_task and fetch."),
  title: z.string(),
  type: z.enum(["epic", "story", "task"]),
  status: statusField,
  priority: z.enum(["low", "medium", "high"]),
  due: z.string().nullable().describe("The day it's due (yyyy-mm-dd), if any."),
  owner: personRef.nullable(),
  private: z.boolean().describe("Seen only by the people on it and the organization's admins."),
  partOf,
  tags: z.array(z.string()),
  url: urlField,
});

const listOutput = z.object({
  space: spaceRef,
  tasks: z.array(taskSummary),
  total: z.number().int().describe("Tasks matching, on every page."),
  nextCursor,
});

const taskDetail = taskSummary.extend({
  space: spaceRef,
  description: z.string().nullable(),
  starts: z.string().nullable().describe("The day work starts (yyyy-mm-dd), if set."),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
  blockedReason: z.string().nullable(),
  createdBy: personRef.nullable(),
  collaborators: z.array(personRef),
  subtasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      type: z.enum(["epic", "story", "task"]),
      status: statusField,
      due: z.string().nullable(),
      owner: personRef.nullable(),
    }),
  ),
  comments: z
    .array(
      z.object({
        author: personRef.nullable(),
        body: z.string(),
        at: z.string(),
        edited: z.boolean(),
      }),
    )
    .describe("The latest comments, oldest first."),
  olderComments: z.boolean().describe("There are older comments than these."),
  recentActivity: z
    .array(z.object({ type: z.string(), at: z.string(), by: z.string().nullable() }))
    .describe("The last changes, newest first."),
});

export type TaskSummary = z.infer<typeof taskSummary>;
export type TaskDetail = z.infer<typeof taskDetail>;

const summarySelect = {
  id: true,
  title: true,
  type: true,
  status: true,
  priority: true,
  dueDate: true,
  visibility: true,
  owner: { select: { id: true, name: true } },
  parentTask: { select: { id: true, title: true } },
  labels: { select: { label: { select: { name: true } } } },
} satisfies Prisma.TaskSelect;

type SummaryRow = Prisma.TaskGetPayload<{ select: typeof summarySelect }>;

function summaryOf(space: ToolSpace, t: SummaryRow): TaskSummary {
  return {
    id: itemId("task", space.id, t.id),
    title: t.title,
    type: TYPE_OUT[t.type],
    status: STATUS_OUT[t.status],
    priority: PRIORITY_OUT[t.priority],
    due: t.dueDate ? dayOf(t.dueDate) : null,
    owner: personOf(space.id, t.owner),
    private: t.visibility === "PRIVATE",
    partOf: t.parentTask
      ? { id: itemId("task", space.id, t.parentTask.id), title: t.parentTask.title }
      : null,
    tags: t.labels.map((l) => l.label.name),
    url: space.url(`/tasks/${t.id}`),
  };
}

/** One task as list_tasks shows it; null when it isn't there or the member can't see it. */
export async function findTaskSummary(
  ctx: OrgContext,
  space: ToolSpace,
  taskId: string,
): Promise<TaskSummary | null> {
  const row = await ctx.db.task.findFirst({
    where: { id: taskId, organizationId: space.id, deletedAt: null },
    select: summarySelect,
  });
  return row ? summaryOf(space, row) : null;
}

// ---------------------------------------------------------------- list_tasks

const listInput = z.object({
  space: spaceArg,
  assignee: z
    .string()
    .max(300)
    .optional()
    .describe('Only tasks this member owns or works on: "me", or a member id from list_members.'),
  status: z
    .enum(["open", "not_started", "in_progress", "blocked", "done", "any"])
    .default("open")
    .describe('"open" (anything not done) unless given.'),
  dueBefore: dayArg.optional().describe("Only tasks due on or before this day (yyyy-mm-dd)."),
  query: z.string().max(200).optional().describe("Words that are in the title or description."),
  limit: limitArg,
  cursor: cursorArg,
});

export type ListTasksInput = z.input<typeof listInput>;

export async function listTasks(
  session: ConnectorSession,
  raw: ListTasksInput,
): Promise<z.infer<typeof listOutput>> {
  const args = listInput.parse(raw);
  const list = listFingerprint("list_tasks", { ...args, limit: undefined, cursor: undefined });
  const position = decodeCursor(args.cursor, list);
  return inSpace(session, args.space, TASKS, async (ctx, space) => {
    let assigneeId: string | undefined;
    if (args.assignee) {
      assigneeId = memberOf(args.assignee, space.id, ctx.userId) ?? undefined;
      if (!assigneeId) {
        throw new ConnectorInputError(
          'The assignee is "me" or a member id from list_members for this space.',
        );
      }
    }
    const where = taskFilterWhere(space.id, {
      status: STATUS_IN[args.status],
      assigneeId,
      q: args.query,
      dueTo: args.dueBefore ? fromDateKey(args.dueBefore) : undefined,
    });
    // One after another: a transaction has one connection.
    const total = await ctx.db.task.count({ where });
    const rows = await ctx.db.task.findMany({
      where,
      select: summarySelect,
      orderBy: [
        { dueDate: { sort: "asc", nulls: "last" } },
        { priority: "desc" },
        { createdAt: "asc" },
        { id: "asc" },
      ],
      skip: position.offset,
      take: args.limit + 1,
    });
    const page = pageOf(rows, args.limit, list, position);
    return {
      space: { id: space.id, name: space.name },
      tasks: page.items.map((t) => summaryOf(space, t)),
      total,
      nextCursor: page.nextCursor,
    };
  });
}

// ---------------------------------------------------------------- get_task

const COMMENTS = 20;
const ACTIVITY = 10;

async function loadTask(ctx: OrgContext, space: ToolSpace, taskId: string): Promise<TaskDetail> {
  // One after another: a transaction has one connection.
  const task = await getTaskDetail(ctx.db, space.id, taskId);
  if (!task) throw new NotFoundError();
  const { comments, hasMore } = await getComments(ctx.db, space.id, task.id, { take: COMMENTS });
  const activity = (await getActivity(ctx.db, space.id, task.id)).slice(0, ACTIVITY);
  return {
    ...summaryOf(space, {
      ...task,
      parentTask: task.parentTask ? { id: task.parentTask.id, title: task.parentTask.title } : null,
    }),
    space: { id: space.id, name: space.name },
    description: task.description,
    starts: task.startDate ? dayOf(task.startDate) : null,
    createdAt: zonedIso(task.createdAt, space.zone),
    completedAt: task.completedAt ? zonedIso(task.completedAt, space.zone) : null,
    blockedReason: task.status === "BLOCKED" ? task.blockedReason : null,
    createdBy: personOf(space.id, task.createdBy),
    collaborators: task.assignees.flatMap((a) => personOf(space.id, a.user) ?? []),
    subtasks: task.subtasks.map((s) => ({
      id: itemId("task", space.id, s.id),
      title: s.title,
      type: TYPE_OUT[s.type],
      status: STATUS_OUT[s.status],
      due: s.dueDate ? dayOf(s.dueDate) : null,
      owner: personOf(space.id, s.owner),
    })),
    comments: comments.map((c) => ({
      author: personOf(space.id, c.author),
      body: c.body,
      at: zonedIso(c.createdAt, space.zone),
      edited: c.editedAt !== null,
    })),
    olderComments: hasMore,
    recentActivity: activity.map((a) => ({
      type: a.type.toLowerCase(),
      at: zonedIso(a.createdAt, space.zone),
      by: a.actor?.name?.trim() || null,
    })),
  };
}

const getInput = z.object({ id: itemArg("task") });

export async function getTask(
  session: ConnectorSession,
  raw: z.input<typeof getInput>,
): Promise<TaskDetail> {
  const ref = refOf(getInput.parse(raw).id, "task");
  return inSpace(session, ref.spaceId, TASKS, (ctx, space) => loadTask(ctx, space, ref.id));
}

const STATUS_WORDS: Record<TaskDetail["status"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

/** A task for fetch: its fields, description and comments as Markdown. */
export async function fetchTask(session: ConnectorSession, ref: ItemRef): Promise<FetchedItem> {
  const task = await inSpace(session, ref.spaceId, TASKS, (ctx, space) =>
    loadTask(ctx, space, ref.id),
  );
  const facts = [
    `Status: ${STATUS_WORDS[task.status]}${task.blockedReason ? ` (${task.blockedReason})` : ""}`,
    `Owner: ${task.owner?.name ?? "Nobody yet"}`,
    task.due && `Due: ${task.due}`,
    task.partOf && `Part of: ${task.partOf.title}`,
    task.collaborators.length > 0 &&
      `Working on it: ${task.collaborators.map((p) => p.name).join(", ")}`,
    task.tags.length > 0 && `Tags: ${task.tags.join(", ")}`,
  ].filter(Boolean);
  const sections = [
    `# ${task.title}`,
    facts.join("\n"),
    task.description,
    task.subtasks.length > 0 &&
      `## Subtasks\n${task.subtasks.map((s) => `- [${s.status === "done" ? "x" : " "}] ${s.title}`).join("\n")}`,
    task.comments.length > 0 &&
      `## Comments\n${task.comments.map((c) => `**${c.author?.name ?? "Member"}** (${c.at}):\n${c.body}`).join("\n\n")}`,
  ].filter(Boolean);
  return {
    id: task.id,
    title: task.title,
    text: sections.join("\n\n"),
    url: task.url,
    metadata: {
      kind: "task",
      spaceId: task.space.id,
      space: task.space.name,
      status: task.status,
      due: task.due,
      private: task.private,
    },
  };
}

// ---------------------------------------------------------------- registration

export const registerTaskTools: ToolRegistrar = (server, session) => {
  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Lists tasks in one space, soonest due first: open ones unless another status is asked for, optionally only one member's, due by a day, or matching words. Each has its id, status, owner, due day and link.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("list_tasks", () => listTasks(session, args)),
  );
  server.registerTool(
    "get_task",
    {
      title: "Get a task",
      description:
        "Gets one task: its description, owner and collaborators, dates, subtasks, latest comments and recent changes.",
      inputSchema: getInput,
      outputSchema: taskDetail,
      annotations: READ_ONLY,
    },
    (args) => readResult("get_task", () => getTask(session, args)),
  );
};
