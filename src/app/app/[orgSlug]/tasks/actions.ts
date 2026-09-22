"use server";

import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";

import { NotificationType, TaskPriority, TaskStatus } from "@/generated/prisma/client";
import { withOrgContext } from "@/lib/auth/with-org-context";
import { notifyUser } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

async function notifyNewAssignees(organizationId: string, taskTitle: string, userIds: string[]) {
  if (userIds.length === 0) return;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true },
  });
  await Promise.all(
    userIds.map((userId) =>
      notifyUser({
        organizationId,
        userId,
        type: NotificationType.TASK_ASSIGNED,
        title: `You were assigned to "${taskTitle}"`,
        linkUrl: org ? `/app/${org.slug}/tasks` : undefined,
      }),
    ),
  );
}

const TASK_STATUS_VALUES = Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]];
const TASK_PRIORITY_VALUES = Object.values(TaskPriority) as [TaskPriority, ...TaskPriority[]];

const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(20000).nullable().optional(),
  status: z.enum(TASK_STATUS_VALUES).optional(),
  priority: z.enum(TASK_PRIORITY_VALUES).optional(),
  dueDate: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  assigneeIds: z.array(z.string()).max(50).optional(),
  labelIds: z.array(z.string()).max(50).optional(),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

interface ActionResult {
  error?: string;
  taskId?: string;
}

async function assertAssigneesAreMembers(
  organizationId: string,
  assigneeIds: string[] | undefined,
) {
  if (!assigneeIds?.length) return null;
  const count = await prisma.membership.count({
    where: { organizationId, userId: { in: assigneeIds } },
  });
  if (count !== new Set(assigneeIds).size) {
    return "One or more assignees aren't members of this organization.";
  }
  return null;
}

async function assertLabelsBelongToOrg(organizationId: string, labelIds: string[] | undefined) {
  if (!labelIds?.length) return null;
  const count = await prisma.label.count({ where: { organizationId, id: { in: labelIds } } });
  if (count !== new Set(labelIds).size) {
    return "One or more labels don't belong to this organization.";
  }
  return null;
}

async function assertProjectBelongsToOrg(
  organizationId: string,
  projectId: string | null | undefined,
) {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  return project ? null : "That project doesn't exist in this organization.";
}

/**
 * One level of nesting only. The intended parent must itself be top-level,
 * and (for updates converting an existing task) the task becoming a child
 * must not already have children — either direction would create two levels.
 */
async function assertValidParent(
  organizationId: string,
  parentTaskId: string | null | undefined,
  taskIdBeingSaved?: string,
) {
  if (!parentTaskId) return null;

  const parent = await prisma.task.findFirst({
    where: { id: parentTaskId, organizationId, deletedAt: null },
    select: { parentTaskId: true },
  });
  if (!parent) return "That parent task doesn't exist.";
  if (parent.parentTaskId) return "Cannot nest a subtask under another subtask.";

  if (taskIdBeingSaved) {
    const childCount = await prisma.task.count({
      where: { parentTaskId: taskIdBeingSaved, deletedAt: null },
    });
    if (childCount > 0) {
      return "This task has subtasks of its own and can't become a subtask.";
    }
  }
  return null;
}

async function nextRankForStatus(organizationId: string, status: TaskStatus) {
  const last = await prisma.task.findFirst({
    where: { organizationId, status, parentTaskId: null, deletedAt: null },
    orderBy: { rank: "desc" },
    select: { rank: true },
  });
  return generateKeyBetween(last?.rank ?? null, null);
}

export const createTask = withOrgContext(async (ctx, input: unknown): Promise<ActionResult> => {
  const parsed = taskInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const assigneeError = await assertAssigneesAreMembers(ctx.organizationId, data.assigneeIds);
  if (assigneeError) return { error: assigneeError };

  const labelError = await assertLabelsBelongToOrg(ctx.organizationId, data.labelIds);
  if (labelError) return { error: labelError };

  const projectError = await assertProjectBelongsToOrg(ctx.organizationId, data.projectId);
  if (projectError) return { error: projectError };

  const parentError = await assertValidParent(ctx.organizationId, data.parentTaskId);
  if (parentError) return { error: parentError };

  const status = data.status ?? TaskStatus.NOT_STARTED;
  const rank = data.parentTaskId
    ? generateNKeysBetween(null, null, 1)[0]
    : await nextRankForStatus(ctx.organizationId, status);

  const task = await prisma.task.create({
    data: {
      organizationId: ctx.organizationId,
      title: data.title,
      description: data.description ?? null,
      status,
      priority: data.priority ?? TaskPriority.MEDIUM,
      dueDate: data.dueDate ? new Date(data.dueDate) : null,
      projectId: data.projectId ?? null,
      parentTaskId: data.parentTaskId ?? null,
      rank,
      createdById: ctx.user.id,
      assignees: data.assigneeIds?.length
        ? { create: data.assigneeIds.map((userId) => ({ userId })) }
        : undefined,
      labels: data.labelIds?.length
        ? { create: data.labelIds.map((labelId) => ({ labelId })) }
        : undefined,
    },
  });

  if (data.assigneeIds?.length) {
    await notifyNewAssignees(ctx.organizationId, task.title, data.assigneeIds);
  }

  return { taskId: task.id };
});

export const updateTask = withOrgContext(
  async (ctx, taskId: string, input: unknown): Promise<ActionResult> => {
    const existing = await prisma.task.findFirst({
      where: { id: taskId, organizationId: ctx.organizationId, deletedAt: null },
      include: { assignees: { select: { userId: true } } },
    });
    if (!existing) {
      return { error: "Task not found." };
    }

    const parsed = taskInputSchema.partial().safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    const assigneeError = await assertAssigneesAreMembers(ctx.organizationId, data.assigneeIds);
    if (assigneeError) return { error: assigneeError };

    const labelError = await assertLabelsBelongToOrg(ctx.organizationId, data.labelIds);
    if (labelError) return { error: labelError };

    const projectError = await assertProjectBelongsToOrg(ctx.organizationId, data.projectId);
    if (projectError) return { error: projectError };

    if (data.parentTaskId !== undefined && data.parentTaskId !== existing.parentTaskId) {
      const parentError = await assertValidParent(ctx.organizationId, data.parentTaskId, taskId);
      if (parentError) return { error: parentError };
    }

    const wasCompleted = existing.status === TaskStatus.COMPLETED;
    const willBeCompleted = (data.status ?? existing.status) === TaskStatus.COMPLETED;

    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: {
          title: data.title,
          description: data.description,
          status: data.status,
          priority: data.priority,
          dueDate:
            data.dueDate === undefined ? undefined : data.dueDate ? new Date(data.dueDate) : null,
          projectId: data.projectId,
          parentTaskId: data.parentTaskId,
          completedAt:
            !wasCompleted && willBeCompleted
              ? new Date()
              : wasCompleted && !willBeCompleted
                ? null
                : undefined,
        },
      });

      if (data.assigneeIds) {
        await tx.taskAssignee.deleteMany({ where: { taskId } });
        if (data.assigneeIds.length) {
          await tx.taskAssignee.createMany({
            data: data.assigneeIds.map((userId) => ({
              organizationId: ctx.organizationId,
              taskId,
              userId,
            })),
          });
        }
      }

      if (data.labelIds) {
        await tx.taskLabel.deleteMany({ where: { taskId } });
        if (data.labelIds.length) {
          await tx.taskLabel.createMany({
            data: data.labelIds.map((labelId) => ({
              organizationId: ctx.organizationId,
              taskId,
              labelId,
            })),
          });
        }
      }
    });

    if (data.assigneeIds) {
      const previousAssigneeIds = new Set(existing.assignees.map((a) => a.userId));
      const newAssigneeIds = data.assigneeIds.filter((id) => !previousAssigneeIds.has(id));
      await notifyNewAssignees(ctx.organizationId, data.title ?? existing.title, newAssigneeIds);
    }

    return { taskId };
  },
);

export const deleteTask = withOrgContext(async (ctx, taskId: string): Promise<ActionResult> => {
  const existing = await prisma.task.findFirst({
    where: { id: taskId, organizationId: ctx.organizationId, deletedAt: null },
  });
  if (!existing) {
    return { error: "Task not found." };
  }

  const now = new Date();
  await prisma.task.updateMany({
    where: { organizationId: ctx.organizationId, OR: [{ id: taskId }, { parentTaskId: taskId }] },
    data: { deletedAt: now },
  });

  return {};
});

export const restoreTask = withOrgContext(async (ctx, taskId: string): Promise<ActionResult> => {
  const existing = await prisma.task.findFirst({
    where: { id: taskId, organizationId: ctx.organizationId },
  });
  if (!existing) {
    return { error: "Task not found." };
  }

  await prisma.task.updateMany({
    where: { organizationId: ctx.organizationId, OR: [{ id: taskId }, { parentTaskId: taskId }] },
    data: { deletedAt: null },
  });

  return {};
});

export interface ReorderInput {
  taskId: string;
  status: TaskStatus;
  beforeId: string | null;
  afterId: string | null;
}

export const reorderTask = withOrgContext(
  async (ctx, input: ReorderInput): Promise<ActionResult> => {
    const task = await prisma.task.findFirst({
      where: {
        id: input.taskId,
        organizationId: ctx.organizationId,
        deletedAt: null,
        parentTaskId: null,
      },
    });
    if (!task) {
      return { error: "Task not found." };
    }

    // beforeId/afterId are client-supplied — verify they're this org's tasks
    // before trusting their rank for anything. Every tenant-scoped lookup
    // filters on organizationId, no exceptions.
    const [before, after] = await Promise.all([
      input.beforeId
        ? prisma.task.findFirst({
            where: { id: input.beforeId, organizationId: ctx.organizationId },
            select: { rank: true },
          })
        : null,
      input.afterId
        ? prisma.task.findFirst({
            where: { id: input.afterId, organizationId: ctx.organizationId },
            select: { rank: true },
          })
        : null,
    ]);

    let rank: string;
    try {
      rank = generateKeyBetween(before?.rank ?? null, after?.rank ?? null);
    } catch {
      // Ranks collided (rare, after many reorders in the same spot) — rebalance
      // the whole column and place the task at the end.
      rank = await rebalanceColumn(ctx.organizationId, input.status, input.taskId);
    }

    await prisma.task.update({
      where: { id: input.taskId },
      data: { status: input.status, rank },
    });

    return {};
  },
);

async function rebalanceColumn(
  organizationId: string,
  status: TaskStatus,
  movedTaskId: string,
): Promise<string> {
  const tasks = await prisma.task.findMany({
    where: {
      organizationId,
      status,
      parentTaskId: null,
      deletedAt: null,
      id: { not: movedTaskId },
    },
    orderBy: { rank: "asc" },
    select: { id: true },
  });
  const keys = generateNKeysBetween(null, null, tasks.length + 1);
  await prisma.$transaction(
    tasks.map((t, i) => prisma.task.update({ where: { id: t.id }, data: { rank: keys[i] } })),
  );
  return keys[keys.length - 1];
}

export const bulkUpdateStatus = withOrgContext(
  async (ctx, taskIds: string[], status: TaskStatus): Promise<ActionResult> => {
    await prisma.task.updateMany({
      where: { id: { in: taskIds }, organizationId: ctx.organizationId, deletedAt: null },
      data: { status, completedAt: status === TaskStatus.COMPLETED ? new Date() : null },
    });
    return {};
  },
);

export const bulkAssign = withOrgContext(
  async (ctx, taskIds: string[], userId: string): Promise<ActionResult> => {
    const isMember = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId: ctx.organizationId } },
    });
    if (!isMember) return { error: "That user isn't a member of this organization." };

    await prisma.$transaction(
      taskIds.map((taskId) =>
        prisma.taskAssignee.upsert({
          where: { taskId_userId: { taskId, userId } },
          update: {},
          // The composite FK (organizationId, taskId) rejects another org's task.
          create: { organizationId: ctx.organizationId, taskId, userId },
        }),
      ),
    );

    const org = await prisma.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { slug: true },
    });
    await notifyUser({
      organizationId: ctx.organizationId,
      userId,
      type: NotificationType.TASK_ASSIGNED,
      title:
        taskIds.length === 1
          ? "You were assigned to a task"
          : `You were assigned to ${taskIds.length} tasks`,
      linkUrl: org ? `/app/${org.slug}/tasks` : undefined,
    });

    return {};
  },
);

export const bulkDelete = withOrgContext(async (ctx, taskIds: string[]): Promise<ActionResult> => {
  const now = new Date();
  await prisma.task.updateMany({
    where: {
      organizationId: ctx.organizationId,
      OR: [{ id: { in: taskIds } }, { parentTaskId: { in: taskIds } }],
    },
    data: { deletedAt: now },
  });
  return {};
});
