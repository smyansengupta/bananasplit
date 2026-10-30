import "server-only";

import { z } from "zod";

import type { TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { NotFoundError } from "@/lib/auth/errors";
import { MAX_BLOCKED_REASON } from "@/lib/tasks/status";
import type { OrgContext } from "@/server/db/context";
import {
  addComment,
  createTask,
  loadTaskEnv,
  MAX_COMMENT_LENGTH,
  TaskError,
  updateTask,
  type FlagConfirmation,
  type TaskActionResult,
} from "@/server/tasks/service";

import { memberOf, refOf } from "./ids";
import {
  ConnectorInputError,
  dayArg,
  itemArg,
  personOf,
  personRef,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type ToolRegistrar,
} from "./shared";
import type { ToolSpace } from "./space";
import { findTaskSummary, TASKS, taskSummary } from "./tasks";
import { zonedIso } from "./text";
import { ADDS, OVERWRITES, refuseOn, WriteRefusedError, writeInSpace } from "./write";

/**
 * create_task, update_task and add_task_comment (docs/features/ai-connectors.md,
 * Phase 3): the app's own task service (src/server/tasks/service.ts) with
 * the member's task environment, so the same permissions, rules,
 * assignment checks, notifications, activity and reminders apply as in the
 * task dialog. Assigning someone notifies them, as in the app.
 */

const PRIORITY_IN: Record<"low" | "medium" | "high", TaskPriority> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
};

const STATUS_IN: Record<"not_started" | "in_progress" | "blocked" | "done", TaskStatus> = {
  not_started: "NOT_STARTED",
  in_progress: "IN_PROGRESS",
  blocked: "BLOCKED",
  done: "COMPLETED",
};

const titleArg = z.string().trim().min(1).max(200);
const descriptionArg = z.string().max(20_000);
const ownerArg = z.string().max(300);
const priorityArg = z.enum(["low", "medium", "high"]);
const statusArg = z.enum(["not_started", "in_progress", "blocked", "done"]);
const blockedReasonArg = z
  .string()
  .max(MAX_BLOCKED_REASON)
  .describe("Why it's blocked; needed when the status is blocked.");
const confirmArg = z
  .boolean()
  .optional()
  .describe(
    "The member confirmed assigning someone above them in the club's org chart (the app asks first).",
  );

const taskOutput = z.object({ space: spaceRef, task: taskSummary });

type TaskOutput = z.infer<typeof taskOutput>;

/** The service's refusals, in its words; an above-level assignment waits for the member. */
async function serviceWrite(run: () => Promise<TaskActionResult>): Promise<string> {
  let result: TaskActionResult;
  try {
    result = await run();
  } catch (error) {
    if (error instanceof TaskError) throw new WriteRefusedError(error.message);
    throw error;
  }
  if (result.confirm) throw confirmRefusal(result.confirm);
  refuseOn(result);
  if (!result.taskId) throw new Error("connectors: the task service returned no task");
  return result.taskId;
}

function confirmRefusal(confirm: FlagConfirmation): WriteRefusedError {
  const names = confirm.flagged.map((f) => f.name?.trim() || "a member").join(", ");
  return new WriteRefusedError(
    `Assigning ${names} goes above the member's place in the club's org chart, and Bananasplit asks before saving that. Nothing was saved. If the member confirms, call again with confirmAboveLevel true.`,
  );
}

/** An owner argument as a user id: "me" or a member id from this space. */
function ownerId(value: string, space: ToolSpace, me: string): string {
  const id = memberOf(value, space.id, me);
  if (!id) {
    throw new ConnectorInputError(
      'The owner is "me" or a member id from list_members for this space.',
    );
  }
  return id;
}

async function taskOutputOf(
  ctx: OrgContext,
  space: ToolSpace,
  taskId: string,
): Promise<TaskOutput> {
  const task = await findTaskSummary(ctx, space, taskId);
  if (!task) throw new NotFoundError();
  return { space: { id: space.id, name: space.name }, task };
}

// ---------------------------------------------------------------- create_task

const createInput = z.object({
  space: spaceArg,
  title: titleArg.describe("The task's title."),
  description: descriptionArg.optional().describe("What needs doing, as Markdown."),
  owner: ownerArg
    .optional()
    .describe('Who owns it: "me", or a member id from list_members. Nobody unless given.'),
  due: dayArg.optional().describe("The day it's due (yyyy-mm-dd)."),
  priority: priorityArg.optional().describe('"medium" unless given.'),
  status: statusArg.optional().describe('"not_started" unless given.'),
  blockedReason: blockedReasonArg.optional(),
  confirmAboveLevel: confirmArg,
});

export async function createTaskTool(
  session: ConnectorSession,
  raw: z.input<typeof createInput>,
): Promise<TaskOutput> {
  const args = createInput.parse(raw);
  return writeInSpace(session, "create_task", args.space, TASKS, async (ctx, space) => {
    const owner = args.owner ? ownerId(args.owner, space, ctx.userId) : null;
    const env = await loadTaskEnv(ctx);
    const taskId = await serviceWrite(() =>
      createTask(env, {
        title: args.title,
        description: args.description ?? null,
        ownerId: owner,
        dueDate: args.due ?? null,
        priority: args.priority ? PRIORITY_IN[args.priority] : undefined,
        status: args.status ? STATUS_IN[args.status] : undefined,
        blockedReason: args.blockedReason ?? null,
        confirmFlagged: args.confirmAboveLevel === true,
      }),
    );
    return {
      output: await taskOutputOf(ctx, space, taskId),
      target: { type: "Task", id: taskId },
    };
  });
}

// ---------------------------------------------------------------- update_task

const updateInput = z.object({
  id: itemArg("task"),
  title: titleArg.optional().describe("A new title."),
  description: descriptionArg
    .nullable()
    .optional()
    .describe("A new description, as Markdown; null clears it."),
  owner: ownerArg
    .nullable()
    .optional()
    .describe('A new owner: "me", or a member id from list_members; null for nobody.'),
  due: dayArg.nullable().optional().describe("A new due day (yyyy-mm-dd); null clears it."),
  priority: priorityArg.optional(),
  status: statusArg.optional(),
  blockedReason: blockedReasonArg.optional(),
  confirmAboveLevel: confirmArg,
});

const CHANGES = ["title", "description", "owner", "due", "priority", "status"] as const;

export async function updateTaskTool(
  session: ConnectorSession,
  raw: z.input<typeof updateInput>,
): Promise<TaskOutput> {
  const args = updateInput.parse(raw);
  const ref = refOf(args.id, "task");
  if (!CHANGES.some((field) => args[field] !== undefined) && args.blockedReason === undefined) {
    throw new ConnectorInputError(
      "Give at least one of title, description, owner, due, priority or status.",
    );
  }
  return writeInSpace(session, "update_task", ref.spaceId, TASKS, async (ctx, space) => {
    // Not there, or private to others: not found, as get_task says.
    if (!(await findTaskSummary(ctx, space, ref.id))) throw new NotFoundError();
    const env = await loadTaskEnv(ctx);
    const owner =
      args.owner === undefined
        ? undefined
        : args.owner === null
          ? null
          : ownerId(args.owner, space, ctx.userId);
    const taskId = await serviceWrite(() =>
      updateTask(env, ref.id, {
        title: args.title,
        description: args.description,
        ownerId: owner,
        dueDate: args.due,
        priority: args.priority ? PRIORITY_IN[args.priority] : undefined,
        status: args.status ? STATUS_IN[args.status] : undefined,
        blockedReason: args.blockedReason,
        confirmFlagged: args.confirmAboveLevel === true,
      }),
    );
    return {
      output: await taskOutputOf(ctx, space, taskId),
      target: { type: "Task", id: taskId },
    };
  });
}

// ---------------------------------------------------------------- add_task_comment

const commentInput = z.object({
  id: itemArg("task"),
  body: z
    .string()
    .trim()
    .min(1)
    .max(MAX_COMMENT_LENGTH)
    .describe("The comment, as Markdown. It's posted as the member."),
});

const commentOutput = z.object({
  space: spaceRef,
  task: z.object({ id: z.string(), title: z.string(), url: urlField }),
  comment: z.object({ author: personRef.nullable(), body: z.string(), at: z.string() }),
});

export async function addTaskCommentTool(
  session: ConnectorSession,
  raw: z.input<typeof commentInput>,
): Promise<z.infer<typeof commentOutput>> {
  const args = commentInput.parse(raw);
  const ref = refOf(args.id, "task");
  return writeInSpace(session, "add_task_comment", ref.spaceId, TASKS, async (ctx, space) => {
    const task = await findTaskSummary(ctx, space, ref.id);
    if (!task) throw new NotFoundError();
    const env = await loadTaskEnv(ctx);
    let commentId: string | undefined;
    try {
      commentId = refuseOn(await addComment(env, ref.id, args.body)).commentId;
    } catch (error) {
      if (error instanceof TaskError) throw new WriteRefusedError(error.message);
      throw error;
    }
    const comment = await ctx.db.taskComment.findFirstOrThrow({
      where: { id: commentId, organizationId: space.id },
      select: { body: true, createdAt: true, author: { select: { id: true, name: true } } },
    });
    return {
      output: {
        space: { id: space.id, name: space.name },
        task: { id: task.id, title: task.title, url: task.url },
        comment: {
          author: personOf(space.id, comment.author),
          body: comment.body,
          at: zonedIso(comment.createdAt, space.zone),
        },
      },
      target: { type: "TaskComment", id: commentId! },
    };
  });
}

// ---------------------------------------------------------------- registration

export const registerTaskWrites: ToolRegistrar = (server, session) => {
  server.registerTool(
    "create_task",
    {
      title: "Create a task",
      description:
        "Creates a task in one space, as the member: a title, and optionally a description, owner, due day, priority and status. The club's task rules apply, and the owner is notified, as in the app.",
      inputSchema: createInput,
      outputSchema: taskOutput,
      annotations: ADDS,
    },
    (args) => readResult("create_task", () => createTaskTool(session, args)),
  );
  server.registerTool(
    "update_task",
    {
      title: "Update a task",
      description:
        "Changes a task's title, description, owner, due day, priority or status; fields left out stay as they are. Only people who may edit the task in the app can, and a new owner is notified.",
      inputSchema: updateInput,
      outputSchema: taskOutput,
      annotations: OVERWRITES,
    },
    (args) => readResult("update_task", () => updateTaskTool(session, args)),
  );
  server.registerTool(
    "add_task_comment",
    {
      title: "Comment on a task",
      description:
        "Adds a comment to a task as the member. The task's owner and the people working on it are notified, as in the app.",
      inputSchema: commentInput,
      outputSchema: commentOutput,
      annotations: ADDS,
    },
    (args) => readResult("add_task_comment", () => addTaskCommentTool(session, args)),
  );
};
