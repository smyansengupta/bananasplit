"use server";

import { refresh } from "next/cache";

import type { TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/auth/errors";
import { withOrgAction } from "@/server/db/context";
import { AppError } from "@/server/db/errors";
import {
  COMMENTS_PAGE_SIZE,
  getActivity,
  getComments,
  getTaskDetail,
  type TaskActivityItem,
  type TaskCommentItem,
  type TaskListItem,
} from "@/server/tasks/queries";
import * as svc from "@/server/tasks/service";
import { postWeeklyUpdate as postWeekly } from "@/server/tasks/weekly";

/**
 * Task Server Actions. Each is a thin shell over src/server/tasks/service.ts
 * inside withOrgAction (app_user, RLS, one transaction; a thrown refusal
 * rolls everything back). Refusals come back as { error }; an above-level
 * assignment comes back as { confirm } with nothing saved. After a write the
 * action calls refresh() so the page re-renders with fresh server data.
 */

export type { TaskActionResult, ReorderInput, SelfAssignAction } from "@/server/tasks/service";

function refusal(error: unknown): string | null {
  if (error instanceof svc.TaskError) return error.message;
  if (error instanceof ForbiddenError)
    return error.message || "You don't have permission to do that.";
  if (error instanceof NotFoundError) return "Not found.";
  if (error instanceof AppError) return error.message;
  return null;
}

async function run<T extends { error?: string; confirm?: unknown }>(
  fn: () => Promise<T>,
  options: { refresh?: boolean } = {},
): Promise<T | { error: string }> {
  try {
    const result = await fn();
    if (options.refresh !== false && !result.error && !result.confirm) refresh();
    return result;
  } catch (error) {
    const message = refusal(error);
    if (message) return { error: message };
    throw error;
  }
}

const withEnv = <Args extends unknown[], R>(fn: (env: svc.TaskEnv, ...args: Args) => Promise<R>) =>
  withOrgAction(async (ctx, ...args: Args) => fn(await svc.loadTaskEnv(ctx), ...args));

const createTaskTx = withEnv(svc.createTask);
const updateTaskTx = withEnv(svc.updateTask);
const setStatusTx = withEnv(svc.setTaskStatus);
const setPriorityTx = withEnv(svc.setTaskPriority);
const selfAssignTx = withEnv(svc.selfAssign);
const acknowledgeTx = withEnv(svc.acknowledgeFlag);
const deleteTx = withEnv(svc.deleteTask);
const restoreTx = withEnv(svc.restoreTask);
const reorderTx = withEnv(svc.reorderTask);
const bulkStatusTx = withEnv(svc.bulkUpdateStatus);
const bulkAssignTx = withEnv(svc.bulkAssign);
const bulkDeleteTx = withEnv(svc.bulkDelete);
const addCommentTx = withEnv(svc.addComment);
const editCommentTx = withEnv(svc.editComment);
const deleteCommentTx = withEnv(svc.deleteComment);
const postWeeklyTx = withEnv(postWeekly);

export async function createTask(orgId: string, input: unknown) {
  return run(() => createTaskTx(orgId, input));
}

export interface ImportedTaskResult {
  key: string;
  taskId?: string;
  error?: string;
  /** Above-level assignments waiting for the member's OK; nothing was saved for this one. */
  confirm?: svc.FlagConfirmation;
}

/**
 * Creates the tasks a member kept from an AI import (src/server/ai), one at a
 * time through the same createTask as the editor: same permissions, rules,
 * assignment checks, notifications and activity, each in its own
 * transaction. One that is refused or needs a confirmation doesn't stop the
 * rest; the dialog shows which, and offers to confirm the flagged ones.
 */
export async function createTasksFromImport(
  orgId: string,
  rows: { key: string; input: unknown }[],
  options: { confirmFlagged?: boolean } = {},
): Promise<{ results: ImportedTaskResult[] }> {
  if (!Array.isArray(rows) || rows.length > 100) return { results: [] };
  const results: ImportedTaskResult[] = [];
  for (const row of rows) {
    const key = typeof row?.key === "string" ? row.key.slice(0, 20) : "";
    const input =
      row?.input && typeof row.input === "object"
        ? { ...(row.input as Record<string, unknown>), confirmFlagged: options.confirmFlagged === true }
        : row?.input;
    try {
      const result = await createTaskTx(orgId, input);
      if (result.confirm) results.push({ key, confirm: result.confirm });
      else if (result.error) results.push({ key, error: result.error });
      else results.push({ key, taskId: result.taskId });
    } catch (error) {
      const message = refusal(error);
      if (!message) throw error;
      results.push({ key, error: message });
    }
  }
  if (results.some((r) => r.taskId)) refresh();
  return { results };
}

export async function updateTask(orgId: string, taskId: string, input: unknown) {
  return run(() => updateTaskTx(orgId, taskId, input));
}

export async function setTaskStatus(
  orgId: string,
  taskId: string,
  status: TaskStatus,
  blockedReason?: string | null,
) {
  return run(() => setStatusTx(orgId, taskId, status, blockedReason));
}

export async function setTaskPriority(orgId: string, taskId: string, priority: TaskPriority) {
  return run(() => setPriorityTx(orgId, taskId, priority));
}

export async function selfAssignTask(orgId: string, taskId: string, action: svc.SelfAssignAction) {
  return run(() => selfAssignTx(orgId, taskId, action));
}

export async function acknowledgeTaskFlag(orgId: string, taskId: string, userId: string) {
  return run(() => acknowledgeTx(orgId, taskId, userId));
}

export async function deleteTask(orgId: string, taskId: string) {
  return run(() => deleteTx(orgId, taskId));
}

export async function restoreTask(orgId: string, taskId: string) {
  return run(() => restoreTx(orgId, taskId));
}

export async function reorderTask(orgId: string, input: svc.ReorderInput) {
  return run(() => reorderTx(orgId, input));
}

export async function bulkUpdateStatus(
  orgId: string,
  taskIds: string[],
  status: TaskStatus,
  blockedReason?: string | null,
) {
  return run(() => bulkStatusTx(orgId, taskIds, status, blockedReason));
}

export async function bulkAssign(
  orgId: string,
  taskIds: string[],
  userId: string,
  options: { role?: "owner" | "collaborator"; confirmFlagged?: boolean } = {},
) {
  return run(() => bulkAssignTx(orgId, { taskIds, userId, ...options }));
}

export async function bulkDelete(orgId: string, taskIds: string[]) {
  return run(() => bulkDeleteTx(orgId, taskIds));
}

export async function addTaskComment(orgId: string, taskId: string, body: string) {
  return run(() => addCommentTx(orgId, taskId, body));
}

export async function editTaskComment(orgId: string, commentId: string, body: string) {
  return run(() => editCommentTx(orgId, commentId, body));
}

export async function deleteTaskComment(orgId: string, commentId: string) {
  return run(() => deleteCommentTx(orgId, commentId));
}

export async function postWeeklyUpdate(
  orgId: string,
  input: { weekStart: string; note?: string | null },
) {
  return run(() => postWeeklyTx(orgId, input));
}

const loadCommentsTx = withOrgAction(async (ctx, taskId: string, before: string | null) => {
  const page = await getComments(ctx.db, ctx.organizationId, taskId, {
    before,
    take: COMMENTS_PAGE_SIZE,
  });
  return page;
});

/** A page of comments for the dialog (lazy-loaded; oldest first). */
export async function loadTaskComments(
  orgId: string,
  taskId: string,
  before: string | null = null,
): Promise<{ comments: TaskCommentItem[]; hasMore: boolean; error?: string }> {
  try {
    return await loadCommentsTx(orgId, taskId, before);
  } catch (error) {
    const message = refusal(error);
    if (message) return { comments: [], hasMore: false, error: message };
    throw error;
  }
}

const loadActivityTx = withOrgAction(async (ctx, taskId: string) =>
  getActivity(ctx.db, ctx.organizationId, taskId),
);

export async function loadTaskActivity(orgId: string, taskId: string): Promise<TaskActivityItem[]> {
  try {
    return await loadActivityTx(orgId, taskId);
  } catch (error) {
    if (refusal(error)) return [];
    throw error;
  }
}

const loadTaskTx = withOrgAction(async (ctx, taskId: string) =>
  getTaskDetail(ctx.db, ctx.organizationId, taskId),
);

/** One task in the list shape (the dialog opens subtasks with it). */
export async function loadTaskDetail(orgId: string, taskId: string): Promise<TaskListItem | null> {
  try {
    return await loadTaskTx(orgId, taskId);
  } catch (error) {
    if (refusal(error)) return null;
    throw error;
  }
}
