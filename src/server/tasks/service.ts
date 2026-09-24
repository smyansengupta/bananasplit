import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";

import {
  NotificationType,
  Prisma,
  TaskPriority,
  TaskStatus,
} from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import {
  canAcknowledgeFlag,
  canEditTask,
  canTriage,
  checkAssignmentChange,
  checkFieldEdit,
  type AssignmentChange,
  type TaskAccessSubject,
  type TaskActor,
} from "@/lib/tasks/access";
import type { ViewerChart } from "@/lib/tasks/assignment";
import {
  addDaysToKey,
  dueDateKey,
  formatDueKey,
  fromDateKey,
  isDateKey,
  localDateKey,
} from "@/lib/tasks/dates";
import {
  diffMentions,
  mentionsToNotify,
  mentionsToPlainText,
  parseMentionIds,
} from "@/lib/tasks/mentions";
import {
  BlockedReasonRequiredError,
  MAX_BLOCKED_REASON,
  statusTransitionData,
  type StatusFields,
} from "@/lib/tasks/status";
import type { OrgContext } from "@/server/db/context";
import { notifyUsers } from "@/server/notifications";

import {
  buildViewerChart,
  classifyAll,
  loadChartNodes,
  type ClassifiedAssignment,
} from "./assignment-policy";
import { scheduleTaskReminders, type ReminderOrg } from "./reminders";

/**
 * Task mutations: the ONE checked path every change goes through (the
 * dialog, quick status/priority toggles, board drags, bulk actions,
 * subtasks, self-assign, comments). Each function takes the action's
 * OrgContext (withOrgAction: app_user, RLS on, one transaction) and:
 *
 * 1. loads the actor's environment once: role, the published chart as a
 *    ViewerChart (hand-down classification and chart-manager rights), the
 *    org's task defaults and the member set;
 * 2. authorizes with the pure rules in src/lib/tasks/access.ts
 *    (assertCanEditTask, the self-assign carve-out, intake triage);
 * 3. classifies every new owner and collaborator (src/lib/tasks/assignment.ts),
 *    asks for confirmation of an above-level assignment (nothing is written
 *    until the actor confirms), and stores the relation and the flag;
 * 4. writes the task, its activity, mentions, notifications (outbox email)
 *    and due-date reminders in the same transaction, so a rolled-back write
 *    never emails anyone.
 *
 * User-facing refusals throw TaskError; the action layer turns them into
 * { error }.
 */

export class TaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskError";
  }
}

export interface FlagConfirmation {
  flagged: { userId: string; name: string | null }[];
}

export interface TaskActionResult {
  error?: string;
  taskId?: string;
  version?: number;
  /** Above-level assignments awaiting the actor's confirmation; nothing was saved. */
  confirm?: FlagConfirmation;
}

export const CONFLICT_MESSAGE = "Someone else changed this task. Reload to see the latest, then try again.";

// ---- Input -----------------------------------------------------------------

const idSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/, "Invalid id");
const dateKeySchema = z.string().refine(isDateKey, "Pick a valid date.");
const STATUS_VALUES = Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]];
const PRIORITY_VALUES = Object.values(TaskPriority) as [TaskPriority, ...TaskPriority[]];

const baseFields = {
  title: z.string().trim().min(1, "Title is required").max(200, "Keep the title under 200 characters"),
  description: z.string().max(20000).nullable().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  blockedReason: z.string().trim().max(MAX_BLOCKED_REASON).nullable().optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  dueDate: dateKeySchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  parentTaskId: idSchema.nullable().optional(),
  ownerId: idSchema.nullable().optional(),
  assigneeIds: z.array(idSchema).max(50).optional(),
  labelIds: z.array(idSchema).max(50).optional(),
  /** The actor confirmed an above-level (flagged) assignment. */
  confirmFlagged: z.boolean().optional(),
};

export const createTaskSchema = z.object(baseFields);
export const updateTaskSchema = z.object({
  ...baseFields,
  title: baseFields.title.optional(),
  /** Optimistic concurrency: the version the editor loaded. */
  expectedVersion: z.number().int().min(1).optional(),
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new TaskError(parsed.error.issues[0]?.message ?? "Invalid input");
  return parsed.data;
}

const uniq = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

// ---- Environment -------------------------------------------------------------

export interface TaskEnv {
  ctx: OrgContext;
  actor: TaskActor;
  chart: ViewerChart;
  org: ReminderOrg & {
    slug: string;
    name: string;
    taskRequireOwner: boolean;
    taskRequireDueDate: boolean;
  };
  memberIds: ReadonlySet<string>;
  now: Date;
}

export async function loadTaskEnv(ctx: OrgContext, now: Date = new Date()): Promise<TaskEnv> {
  const org = await ctx.db.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
    select: {
      id: true,
      slug: true,
      name: true,
      timezone: true,
      settings: {
        select: { taskRequireOwner: true, taskRequireDueDate: true, reminderLeadDaysDefault: true },
      },
    },
  });
  const members = await ctx.db.membership.findMany({
    where: { organizationId: ctx.organizationId },
    select: { userId: true },
  });
  const chart = buildViewerChart(await loadChartNodes(ctx.db, ctx.organizationId), ctx.userId);
  return {
    ctx,
    actor: { userId: ctx.userId, isAdmin: can(ctx, "tasks.manageAll"), subtree: chart.subtree },
    chart,
    org: {
      id: org.id,
      slug: org.slug,
      name: org.name,
      timezone: org.timezone,
      taskRequireOwner: org.settings?.taskRequireOwner ?? false,
      taskRequireDueDate: org.settings?.taskRequireDueDate ?? false,
      reminderLeadDaysDefault: org.settings?.reminderLeadDaysDefault ?? 1,
    },
    memberIds: new Set(members.map((m) => m.userId)),
    now,
  };
}

export function taskPath(orgSlug: string, taskId: string): string {
  return `/app/${orgSlug}/tasks/${taskId}`;
}

// ---- The task as the rules see it ---------------------------------------------

const subjectSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  dueDate: true,
  projectId: true,
  parentTaskId: true,
  createdById: true,
  ownerId: true,
  ownerFlagged: true,
  completedAt: true,
  blockedAt: true,
  blockedReason: true,
  version: true,
  rank: true,
  deletedAt: true,
  assignees: { select: { userId: true, flagged: true, flagAcknowledgedAt: true } },
  project: { select: { isIntake: true, triageUserId: true, defaultDueInDays: true } },
} satisfies Prisma.TaskSelect;

type Subject = Prisma.TaskGetPayload<{ select: typeof subjectSelect }>;

async function loadSubject(env: TaskEnv, taskId: string, includeDeleted = false): Promise<Subject> {
  const task = await env.ctx.db.task.findFirst({
    where: {
      id: parse(idSchema, taskId),
      organizationId: env.ctx.organizationId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    },
    select: subjectSelect,
  });
  if (!task) throw new TaskError("Task not found.");
  return task;
}

function accessOf(s: Subject): TaskAccessSubject {
  return {
    createdById: s.createdById,
    ownerId: s.ownerId,
    assigneeIds: s.assignees.map((a) => a.userId),
    isIntake: s.project?.isIntake ?? false,
    triageUserId: s.project?.triageUserId ?? null,
  };
}

function statusFieldsOf(s: Subject): StatusFields {
  return {
    status: s.status,
    completedAt: s.completedAt,
    blockedAt: s.blockedAt,
    blockedReason: s.blockedReason,
  };
}

function transition(prev: StatusFields, next: TaskStatus, blockedReason?: string | null, now?: Date) {
  try {
    return statusTransitionData(prev, next, { blockedReason, now });
  } catch (error) {
    if (error instanceof BlockedReasonRequiredError) throw new TaskError(error.message);
    throw error;
  }
}

// ---- The one checked assignment path ---------------------------------------------

export interface AssignmentPlan {
  ownerChange: { ownerId: string | null; previousOwnerId: string | null; classified: ClassifiedAssignment | null } | null;
  add: ClassifiedAssignment[];
  remove: string[];
}

function isEmptyChange(change: AssignmentChange): boolean {
  return (
    change.ownerId === undefined &&
    !(change.addAssigneeIds?.length ?? 0) &&
    !(change.removeAssigneeIds?.length ?? 0)
  );
}

/**
 * Authorizes and classifies an assignment change. Every assignment path
 * (create, update, self-assign, bulk, subtask) calls this: membership of
 * every new person, assertCanEditTask or the self-assign carve-out, intake
 * triage, and the hand-down classification of each new owner and
 * collaborator against the published chart.
 */
export function planAssignment(
  env: Pick<TaskEnv, "actor" | "chart" | "memberIds">,
  subject: TaskAccessSubject,
  change: AssignmentChange,
): AssignmentPlan {
  const adds = uniq(change.addAssigneeIds ?? []).filter((id) => !subject.assigneeIds.includes(id));
  const removes = uniq(change.removeAssigneeIds ?? []).filter((id) => subject.assigneeIds.includes(id));
  const ownerChanging = change.ownerId !== undefined && change.ownerId !== subject.ownerId;
  const newOwner = ownerChanging ? (change.ownerId ?? null) : subject.ownerId;

  for (const userId of [...adds, ...(ownerChanging && newOwner ? [newOwner] : [])]) {
    if (!env.memberIds.has(userId)) throw new TaskError("That person isn't a member of this organization.");
  }

  const check = checkAssignmentChange(env.actor, subject, {
    ownerId: ownerChanging ? newOwner : undefined,
    addAssigneeIds: adds,
    removeAssigneeIds: removes,
  });
  if (!check.ok) throw new TaskError(check.reason);

  // The owner is never also listed as a collaborator.
  const addFinal = adds.filter((id) => id !== newOwner);
  const removeFinal = uniq([
    ...removes,
    ...(newOwner && subject.assigneeIds.includes(newOwner) ? [newOwner] : []),
  ]);

  return {
    ownerChange: ownerChanging
      ? {
          ownerId: newOwner,
          previousOwnerId: subject.ownerId,
          classified: newOwner ? classifyAll(env.chart, [newOwner])[0]! : null,
        }
      : null,
    add: classifyAll(env.chart, addFinal),
    remove: removeFinal,
  };
}

export function flaggedAssignments(plan: AssignmentPlan | null): ClassifiedAssignment[] {
  if (!plan) return [];
  const owner = plan.ownerChange?.classified;
  return [...(owner?.flagged ? [owner] : []), ...plan.add.filter((a) => a.flagged)];
}

async function confirmationFor(env: TaskEnv, flagged: ClassifiedAssignment[]): Promise<TaskActionResult> {
  const ids = uniq(flagged.map((f) => f.userId));
  const users = await env.ctx.db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return { confirm: { flagged: ids.map((userId) => ({ userId, name: names.get(userId) ?? null })) } };
}

function ownerUpdateData(env: TaskEnv, plan: AssignmentPlan | null): Prisma.TaskUncheckedUpdateManyInput {
  if (!plan?.ownerChange) return {};
  const c = plan.ownerChange.classified;
  return {
    ownerId: plan.ownerChange.ownerId,
    ownerRelation: c?.relation ?? null,
    ownerFlagged: c?.flagged ?? false,
    ownerAssignedById: plan.ownerChange.ownerId ? env.actor.userId : null,
  };
}

async function writeAssignees(env: TaskEnv, taskId: string, plan: AssignmentPlan | null): Promise<void> {
  if (!plan) return;
  const { db, organizationId } = env.ctx;
  if (plan.remove.length > 0) {
    await db.taskAssignee.deleteMany({ where: { organizationId, taskId, userId: { in: plan.remove } } });
  }
  if (plan.add.length > 0) {
    await db.taskAssignee.createMany({
      data: plan.add.map((a) => ({
        organizationId,
        taskId,
        userId: a.userId,
        assignedById: env.actor.userId,
        relation: a.relation,
        flagged: a.flagged,
      })),
      skipDuplicates: true,
    });
  }
}

type ActivityRow = { type: string; diffJson: Prisma.InputJsonValue };

function assignmentActivity(plan: AssignmentPlan | null): ActivityRow[] {
  if (!plan) return [];
  const rows: ActivityRow[] = [];
  const oc = plan.ownerChange;
  if (oc) {
    if (oc.ownerId) {
      rows.push({
        type: "ASSIGNED",
        diffJson: { role: "owner", userId: oc.ownerId, from: oc.previousOwnerId, relation: oc.classified?.relation ?? null },
      });
      if (oc.classified?.flagged) {
        rows.push({ type: "FLAGGED", diffJson: { role: "owner", userId: oc.ownerId, relation: "ABOVE" } });
      }
    } else if (oc.previousOwnerId) {
      rows.push({ type: "UNASSIGNED", diffJson: { role: "owner", userId: oc.previousOwnerId } });
    }
  }
  for (const a of plan.add) {
    rows.push({ type: "ASSIGNED", diffJson: { role: "collaborator", userId: a.userId, relation: a.relation } });
    if (a.flagged) rows.push({ type: "FLAGGED", diffJson: { role: "collaborator", userId: a.userId, relation: "ABOVE" } });
  }
  for (const userId of plan.remove) {
    rows.push({ type: "UNASSIGNED", diffJson: { role: "collaborator", userId } });
  }
  return rows;
}

async function writeActivity(env: TaskEnv, taskId: string, rows: ActivityRow[]): Promise<void> {
  if (rows.length === 0) return;
  await env.ctx.db.taskActivity.createMany({
    data: rows.map((r) => ({
      organizationId: env.ctx.organizationId,
      taskId,
      actorId: env.actor.userId,
      type: r.type,
      diffJson: r.diffJson,
    })),
  });
}

function actorName(env: TaskEnv): string {
  return env.ctx.user.name?.trim() || "A teammate";
}

function quoted(title: string): string {
  return `"${title.length > 120 ? `${title.slice(0, 119)}…` : title}"`;
}

function assignmentBody(env: TaskEnv, task: { dueDate: Date | null; priority: TaskPriority }, flagged: boolean) {
  const today = localDateKey(env.now, env.org.timezone);
  const due = task.dueDate ? `Due ${formatDueKey(dueDateKey(task.dueDate), today)}` : "No due date";
  const parts = [due, `${task.priority.charAt(0)}${task.priority.slice(1).toLowerCase()} priority`];
  if (flagged) parts.push("Flagged: assigned from below your level");
  return parts.join(" · ");
}

/** Assignment emails (outbox) for new owners and collaborators; never for self-assignment. */
async function notifyAssignment(
  env: TaskEnv,
  task: { id: string; title: string; dueDate: Date | null; priority: TaskPriority },
  plan: AssignmentPlan | null,
): Promise<void> {
  if (!plan) return;
  const { db, organizationId } = env.ctx;
  const linkUrl = taskPath(env.org.slug, task.id);
  const owner = plan.ownerChange?.classified;
  if (owner && owner.userId !== env.actor.userId) {
    await notifyUsers(db, organizationId, [owner.userId], {
      type: owner.flagged ? NotificationType.TASK_FLAGGED : NotificationType.TASK_ASSIGNED,
      title: `${actorName(env)} assigned you ${quoted(task.title)}`,
      body: assignmentBody(env, task, owner.flagged),
      linkUrl,
      taskId: task.id,
      actorId: env.actor.userId,
    });
  }
  for (const a of plan.add) {
    if (a.userId === env.actor.userId) continue;
    await notifyUsers(db, organizationId, [a.userId], {
      type: a.flagged ? NotificationType.TASK_FLAGGED : NotificationType.TASK_ASSIGNED,
      title: `${actorName(env)} added you to ${quoted(task.title)}`,
      body: assignmentBody(env, task, a.flagged),
      linkUrl,
      taskId: task.id,
      actorId: env.actor.userId,
    });
  }
}

/**
 * Stores the @mentions in one source ('desc' or a comment id), diffed
 * against what is already stored, and notifies the newly mentioned members
 * (never the actor). Hand-typed tokens for non-members are ignored.
 */
async function syncMentions(
  env: TaskEnv,
  task: { id: string; title: string },
  sourceKey: string,
  markdown: string | null,
): Promise<string[]> {
  const { db, organizationId } = env.ctx;
  const next = parseMentionIds(markdown).filter((id) => env.memberIds.has(id));
  const existing = (
    await db.taskMention.findMany({
      where: { organizationId, taskId: task.id, sourceKey },
      select: { mentionedUserId: true },
    })
  ).map((m) => m.mentionedUserId);
  const { added, removed } = diffMentions(existing, next);
  if (removed.length > 0) {
    await db.taskMention.deleteMany({
      where: { organizationId, taskId: task.id, sourceKey, mentionedUserId: { in: removed } },
    });
  }
  if (added.length > 0) {
    await db.taskMention.createMany({
      data: added.map((mentionedUserId) => ({
        organizationId,
        taskId: task.id,
        sourceKey,
        mentionedUserId,
        mentionedById: env.actor.userId,
      })),
      skipDuplicates: true,
    });
  }
  const notify = mentionsToNotify(existing, next, env.actor.userId);
  if (notify.length > 0) {
    const excerpt = markdown ? mentionsToPlainText(markdown).replace(/\s+/g, " ").trim().slice(0, 280) : null;
    await notifyUsers(db, organizationId, notify, {
      type: NotificationType.TASK_MENTIONED,
      title: `${actorName(env)} mentioned you on ${quoted(task.title)}`,
      body: excerpt,
      linkUrl: taskPath(env.org.slug, task.id),
      taskId: task.id,
      actorId: env.actor.userId,
      dedupeKey: `mention:${task.id}:${sourceKey}`,
    });
  }
  return notify;
}

// ---- Validation helpers ----------------------------------------------------------

async function loadProject(env: TaskEnv, projectId: string) {
  const project = await env.ctx.db.project.findFirst({
    where: { id: projectId, organizationId: env.ctx.organizationId, archivedAt: null },
    select: { id: true, isIntake: true, triageUserId: true, defaultDueInDays: true },
  });
  if (!project) throw new TaskError("That project doesn't exist in this organization.");
  return project;
}

async function assertLabels(env: TaskEnv, labelIds: readonly string[]): Promise<void> {
  if (labelIds.length === 0) return;
  const count = await env.ctx.db.label.count({
    where: { organizationId: env.ctx.organizationId, id: { in: [...labelIds] } },
  });
  if (count !== labelIds.length) throw new TaskError("One or more labels don't belong to this organization.");
}

/** One level of nesting: the parent must be top-level and editable by the actor. */
async function loadParent(env: TaskEnv, parentTaskId: string, childId?: string): Promise<Subject> {
  const parent = await loadSubject(env, parentTaskId).catch(() => {
    throw new TaskError("That parent task doesn't exist.");
  });
  if (parent.parentTaskId) throw new TaskError("Cannot nest a subtask under another subtask.");
  if (childId && parent.id === childId) throw new TaskError("A task can't be its own subtask.");
  if (!canEditTask(env.actor, accessOf(parent))) {
    throw new TaskError("You can only break down tasks you can edit.");
  }
  if (childId) {
    const children = await env.ctx.db.task.count({
      where: { organizationId: env.ctx.organizationId, parentTaskId: childId, deletedAt: null },
    });
    if (children > 0) throw new TaskError("This task has subtasks of its own and can't become a subtask.");
  }
  return parent;
}

async function nextRankForStatus(env: TaskEnv, status: TaskStatus): Promise<string> {
  const last = await env.ctx.db.task.findFirst({
    where: { organizationId: env.ctx.organizationId, status, parentTaskId: null, deletedAt: null },
    orderBy: { rank: "desc" },
    select: { rank: true },
  });
  return generateKeyBetween(last?.rank ?? null, null);
}

/** Sibling rank after the last subtask (distinct ranks: fixes the identical-rank bug). */
async function nextSubtaskRank(env: TaskEnv, parentTaskId: string): Promise<string> {
  const last = await env.ctx.db.task.findFirst({
    where: { organizationId: env.ctx.organizationId, parentTaskId, deletedAt: null },
    orderBy: { rank: "desc" },
    select: { rank: true },
  });
  return generateKeyBetween(last?.rank ?? null, null);
}

// ---- Create ----------------------------------------------------------------------

export async function createTask(env: TaskEnv, input: unknown): Promise<TaskActionResult> {
  const d = parse(createTaskSchema, input);
  const { db, organizationId } = env.ctx;

  const project = d.projectId ? await loadProject(env, d.projectId) : null;
  const parent = d.parentTaskId ? await loadParent(env, d.parentTaskId) : null;
  const isIntake = project?.isIntake ?? false;
  const subject: TaskAccessSubject = {
    createdById: env.actor.userId,
    ownerId: null,
    assigneeIds: [],
    isIntake,
    triageUserId: project?.triageUserId ?? null,
  };
  const triage = canTriage(env.actor, subject);
  if (isIntake && !triage && d.priority && d.priority !== TaskPriority.MEDIUM) {
    throw new TaskError("Only the request's triage owner or an admin sets its priority.");
  }

  let dueKey = d.dueDate ?? null;
  if (!dueKey && isIntake && project?.defaultDueInDays) {
    dueKey = addDaysToKey(localDateKey(env.now, env.org.timezone), project.defaultDueInDays);
  }
  if (!parent) {
    if (env.org.taskRequireOwner && !isIntake && !d.ownerId) {
      throw new TaskError("Every task needs an owner.");
    }
    if (env.org.taskRequireDueDate && !dueKey) throw new TaskError("Every task needs a due date.");
  }

  const labelIds = uniq(d.labelIds ?? []);
  await assertLabels(env, labelIds);

  const plan = planAssignment(env, subject, {
    ownerId: d.ownerId ?? null,
    addAssigneeIds: d.assigneeIds ?? [],
  });
  const flagged = flaggedAssignments(plan);
  if (flagged.length > 0 && !d.confirmFlagged) return confirmationFor(env, flagged);

  const status = d.status ?? TaskStatus.NOT_STARTED;
  const statusData = transition(
    { status: TaskStatus.NOT_STARTED, completedAt: null, blockedAt: null, blockedReason: null },
    status,
    d.blockedReason,
    env.now,
  );
  const rank = parent ? await nextSubtaskRank(env, parent.id) : await nextRankForStatus(env, status);
  const priority = isIntake && !triage ? TaskPriority.MEDIUM : (d.priority ?? TaskPriority.MEDIUM);
  const oc = plan.ownerChange;

  const task = await db.task.create({
    data: {
      organizationId,
      title: d.title,
      description: d.description?.trim() ? d.description : null,
      ...statusData,
      priority,
      dueDate: dueKey ? fromDateKey(dueKey) : null,
      projectId: project?.id ?? null,
      parentTaskId: parent?.id ?? null,
      rank,
      createdById: env.actor.userId,
      ownerId: oc?.ownerId ?? null,
      ownerRelation: oc?.classified?.relation ?? null,
      ownerFlagged: oc?.classified?.flagged ?? false,
      ownerAssignedById: oc?.ownerId ? env.actor.userId : null,
    },
    select: { id: true, version: true, title: true, dueDate: true, priority: true, status: true },
  });

  if (labelIds.length > 0) {
    await db.taskLabel.createMany({
      data: labelIds.map((labelId) => ({ organizationId, taskId: task.id, labelId })),
    });
  }
  await writeAssignees(env, task.id, plan);
  await writeActivity(env, task.id, [
    {
      type: "CREATED",
      diffJson: { title: task.title, ...(parent ? { parentTaskId: parent.id } : {}), ...(isIntake ? { intake: true } : {}) },
    },
    ...(status === TaskStatus.BLOCKED ? [{ type: "BLOCKED", diffJson: { reason: statusData.blockedReason } }] : []),
    ...assignmentActivity(plan),
  ]);
  await syncMentions(env, task, "desc", d.description ?? null);
  await notifyAssignment(env, task, plan);
  if (isIntake && !plan.ownerChange?.ownerId && subject.triageUserId && subject.triageUserId !== env.actor.userId) {
    // A new request lands in the triage owner's queue.
    await notifyUsers(db, organizationId, [subject.triageUserId], {
      type: NotificationType.TASK_ASSIGNED,
      title: `${actorName(env)} filed a request: ${quoted(task.title)}`,
      body: "Set its priority and owner in the intake queue.",
      linkUrl: taskPath(env.org.slug, task.id),
      taskId: task.id,
      actorId: env.actor.userId,
      dedupeKey: `intake:${task.id}`,
    });
  }
  await scheduleTaskReminders(
    db,
    env.org,
    task,
    [...(plan.ownerChange?.ownerId ? [plan.ownerChange.ownerId] : []), ...plan.add.map((a) => a.userId)],
    env.now,
  );
  return { taskId: task.id, version: task.version };
}

// ---- Update ----------------------------------------------------------------------

export async function updateTask(env: TaskEnv, taskId: string, input: unknown): Promise<TaskActionResult> {
  const d = parse(updateTaskSchema, input);
  const s = await loadSubject(env, taskId);
  return applyUpdate(env, s, d);
}

async function applyUpdate(
  env: TaskEnv,
  s: Subject,
  d: z.output<typeof updateTaskSchema>,
): Promise<TaskActionResult> {
  const { db, organizationId } = env.ctx;
  const access = accessOf(s);
  const data: Prisma.TaskUncheckedUpdateManyInput = {};
  const activity: ActivityRow[] = [];
  let fieldEdit = false;
  let priorityEdit = false;

  if (d.title !== undefined && d.title !== s.title) {
    data.title = d.title;
    fieldEdit = true;
  }
  const nextDescription = d.description === undefined ? undefined : d.description?.trim() ? d.description : null;
  const descriptionChanged = nextDescription !== undefined && nextDescription !== s.description;
  if (descriptionChanged) {
    data.description = nextDescription;
    fieldEdit = true;
  }
  if (d.priority !== undefined && d.priority !== s.priority) {
    data.priority = d.priority;
    fieldEdit = true;
    priorityEdit = true;
  }

  const prevDueKey = s.dueDate ? dueDateKey(s.dueDate) : null;
  const dueChanged = d.dueDate !== undefined && (d.dueDate ?? null) !== prevDueKey;
  if (dueChanged) {
    data.dueDate = d.dueDate ? fromDateKey(d.dueDate) : null;
    activity.push({ type: "DUE_CHANGED", diffJson: { from: prevDueKey, to: d.dueDate ?? null } });
    fieldEdit = true;
  }

  const wantsStatus = d.status !== undefined ? d.status : undefined;
  const reasonChanged =
    d.blockedReason !== undefined && (d.blockedReason?.trim() || null) !== (s.blockedReason ?? null);
  let reopened = false;
  let nextStatus = s.status;
  if ((wantsStatus !== undefined && wantsStatus !== s.status) || (reasonChanged && (wantsStatus ?? s.status) === TaskStatus.BLOCKED)) {
    const target = wantsStatus ?? s.status;
    const sf = transition(statusFieldsOf(s), target, d.blockedReason, env.now);
    Object.assign(data, sf);
    nextStatus = target;
    fieldEdit = true;
    if (target !== s.status) {
      activity.push({ type: "STATUS_CHANGED", diffJson: { from: s.status, to: target } });
      reopened = s.status === TaskStatus.COMPLETED;
    }
    if (target === TaskStatus.BLOCKED) activity.push({ type: "BLOCKED", diffJson: { reason: sf.blockedReason } });
  }

  let nextProject = s.project;
  if (d.projectId !== undefined && d.projectId !== s.projectId) {
    nextProject = d.projectId ? await loadProject(env, d.projectId) : null;
    data.projectId = d.projectId;
    fieldEdit = true;
  }

  let nextParentId = s.parentTaskId;
  if (d.parentTaskId !== undefined && d.parentTaskId !== s.parentTaskId) {
    if (d.parentTaskId) {
      const parent = await loadParent(env, d.parentTaskId, s.id);
      data.rank = await nextSubtaskRank(env, parent.id);
    } else {
      data.rank = await nextRankForStatus(env, nextStatus);
    }
    data.parentTaskId = d.parentTaskId;
    nextParentId = d.parentTaskId;
    fieldEdit = true;
  }

  let labelChange: string[] | null = null;
  if (d.labelIds) {
    const next = uniq(d.labelIds);
    const current = await db.taskLabel.findMany({
      where: { organizationId, taskId: s.id },
      select: { labelId: true },
    });
    const currentIds = current.map((l) => l.labelId).sort();
    if (next.slice().sort().join(",") !== currentIds.join(",")) {
      await assertLabels(env, next);
      labelChange = next;
      fieldEdit = true;
    }
  }

  if (fieldEdit) {
    const check = checkFieldEdit(env.actor, access, { priority: priorityEdit });
    if (!check.ok) throw new TaskError(check.reason);
  }

  const change: AssignmentChange = {};
  if (d.ownerId !== undefined && d.ownerId !== s.ownerId) change.ownerId = d.ownerId;
  if (d.assigneeIds) {
    const next = uniq(d.assigneeIds);
    change.addAssigneeIds = next.filter((id) => !access.assigneeIds.includes(id));
    change.removeAssigneeIds = access.assigneeIds.filter((id) => !next.includes(id));
  }
  const plan = isEmptyChange(change) ? null : planAssignment(env, access, change);
  const flagged = flaggedAssignments(plan);
  if (flagged.length > 0 && !d.confirmFlagged) return confirmationFor(env, flagged);

  const topLevel = nextParentId === null;
  const intake = nextProject?.isIntake ?? false;
  if (topLevel && env.org.taskRequireOwner && !intake && plan?.ownerChange && !plan.ownerChange.ownerId) {
    throw new TaskError("Every task needs an owner.");
  }
  if (topLevel && env.org.taskRequireDueDate && dueChanged && !d.dueDate) {
    throw new TaskError("Every task needs a due date.");
  }

  if (!fieldEdit && !plan) return { taskId: s.id, version: s.version };

  const res = await db.task.updateMany({
    where: {
      id: s.id,
      organizationId,
      deletedAt: null,
      ...(d.expectedVersion !== undefined ? { version: d.expectedVersion } : {}),
    },
    data: { ...data, ...ownerUpdateData(env, plan), version: { increment: 1 } },
  });
  if (res.count === 0) throw new TaskError(CONFLICT_MESSAGE);

  if (labelChange) {
    await db.taskLabel.deleteMany({ where: { organizationId, taskId: s.id } });
    if (labelChange.length > 0) {
      await db.taskLabel.createMany({
        data: labelChange.map((labelId) => ({ organizationId, taskId: s.id, labelId })),
      });
    }
  }
  await writeAssignees(env, s.id, plan);
  await writeActivity(env, s.id, [...activity, ...assignmentActivity(plan)]);

  const title = (data.title as string | undefined) ?? s.title;
  const after = {
    id: s.id,
    title,
    dueDate: dueChanged ? (d.dueDate ? fromDateKey(d.dueDate) : null) : s.dueDate,
    priority: (data.priority as TaskPriority | undefined) ?? s.priority,
    status: nextStatus,
  };
  if (descriptionChanged) await syncMentions(env, after, "desc", nextDescription ?? null);
  await notifyAssignment(env, after, plan);

  // Reminders: everyone on a moved or reopened task; otherwise only the newcomers.
  const finalOwner = plan?.ownerChange ? plan.ownerChange.ownerId : s.ownerId;
  const finalAssignees = uniq([
    ...access.assigneeIds.filter((id) => !(plan?.remove ?? []).includes(id)),
    ...(plan?.add ?? []).map((a) => a.userId),
  ]);
  const recipients =
    dueChanged || reopened
      ? [...(finalOwner ? [finalOwner] : []), ...finalAssignees]
      : [
          ...(plan?.ownerChange?.ownerId ? [plan.ownerChange.ownerId] : []),
          ...(plan?.add ?? []).map((a) => a.userId),
        ];
  await scheduleTaskReminders(db, env.org, after, recipients, env.now);

  return { taskId: s.id, version: s.version + 1 };
}

// ---- Quick paths (all through applyUpdate) ------------------------------------------

export async function setTaskStatus(
  env: TaskEnv,
  taskId: string,
  status: TaskStatus,
  blockedReason?: string | null,
): Promise<TaskActionResult> {
  return updateTask(env, taskId, { status, blockedReason });
}

export async function setTaskPriority(env: TaskEnv, taskId: string, priority: TaskPriority) {
  return updateTask(env, taskId, { priority });
}

export type SelfAssignAction = "join" | "leave" | "claim" | "release";

/** The self-assign carve-out: join or leave as a collaborator, claim or release ownership. */
export async function selfAssign(env: TaskEnv, taskId: string, action: SelfAssignAction): Promise<TaskActionResult> {
  const s = await loadSubject(env, taskId);
  const me = env.actor.userId;
  const current = s.assignees.map((a) => a.userId);
  switch (action) {
    case "join":
      return applyUpdate(env, s, { assigneeIds: [...current, me] });
    case "leave":
      return applyUpdate(env, s, { assigneeIds: current.filter((id) => id !== me) });
    case "claim":
      if (s.ownerId && s.ownerId !== me) throw new TaskError("This task already has an owner.");
      return applyUpdate(env, s, { ownerId: me });
    case "release":
      if (s.ownerId !== me) throw new TaskError("You're not the owner of this task.");
      return applyUpdate(env, s, { ownerId: null });
    default:
      throw new TaskError("Unknown action.");
  }
}

/** The flagged person or OWNER/ADMIN acknowledges an above-level assignment. */
export async function acknowledgeFlag(env: TaskEnv, taskId: string, userId: string): Promise<TaskActionResult> {
  const s = await loadSubject(env, taskId);
  if (!canAcknowledgeFlag(env.actor, userId)) {
    throw new TaskError("Only the person it was assigned to or an admin can acknowledge the flag.");
  }
  const { db, organizationId } = env.ctx;
  let changed = false;
  if (s.ownerId === userId && s.ownerFlagged) {
    await db.task.updateMany({
      where: { id: s.id, organizationId },
      data: { ownerFlagged: false, version: { increment: 1 } },
    });
    changed = true;
  }
  const res = await db.taskAssignee.updateMany({
    where: { organizationId, taskId: s.id, userId, flagged: true, flagAcknowledgedAt: null },
    data: { flagAcknowledgedAt: env.now },
  });
  if (res.count > 0) changed = true;
  if (changed) await writeActivity(env, s.id, [{ type: "FLAG_ACKNOWLEDGED", diffJson: { userId } }]);
  return { taskId: s.id };
}

// ---- Board reorder -----------------------------------------------------------------

export const reorderSchema = z.object({
  taskId: idSchema,
  status: z.enum(STATUS_VALUES),
  beforeId: idSchema.nullable(),
  afterId: idSchema.nullable(),
  blockedReason: z.string().trim().max(MAX_BLOCKED_REASON).nullable().optional(),
});

export type ReorderInput = z.input<typeof reorderSchema>;

export async function reorderTask(env: TaskEnv, input: unknown): Promise<TaskActionResult> {
  const d = parse(reorderSchema, input);
  const { db, organizationId } = env.ctx;
  const s = await loadSubject(env, d.taskId);
  if (s.parentTaskId) throw new TaskError("Subtasks move with their parent.");
  const check = checkFieldEdit(env.actor, accessOf(s), {});
  if (!check.ok) throw new TaskError(check.reason);

  // Client-supplied neighbours: only this org's live top-level tasks in the target column.
  const neighbour = (id: string | null) =>
    id
      ? db.task.findFirst({
          where: { id, organizationId, deletedAt: null, parentTaskId: null, status: d.status },
          select: { rank: true },
        })
      : Promise.resolve(null);
  const before = await neighbour(d.beforeId);
  const after = await neighbour(d.afterId);

  let rank: string;
  try {
    rank = generateKeyBetween(before?.rank ?? null, after?.rank ?? null);
  } catch {
    rank = await rebalanceColumn(env, d.status, s.id);
  }

  const data: Prisma.TaskUncheckedUpdateManyInput = { rank, version: { increment: 1 } };
  const activity: ActivityRow[] = [];
  let reopened = false;
  if (d.status !== s.status) {
    Object.assign(data, transition(statusFieldsOf(s), d.status, d.blockedReason, env.now));
    activity.push({ type: "STATUS_CHANGED", diffJson: { from: s.status, to: d.status } });
    if (d.status === TaskStatus.BLOCKED) {
      activity.push({ type: "BLOCKED", diffJson: { reason: (data.blockedReason as string) ?? null } });
    }
    reopened = s.status === TaskStatus.COMPLETED;
  }
  await db.task.updateMany({ where: { id: s.id, organizationId }, data });
  await writeActivity(env, s.id, activity);
  if (reopened) {
    await scheduleTaskReminders(
      db,
      env.org,
      { id: s.id, dueDate: s.dueDate, status: d.status },
      [...(s.ownerId ? [s.ownerId] : []), ...s.assignees.map((a) => a.userId)],
      env.now,
    );
  }
  return { taskId: s.id, version: s.version + 1 };
}

async function rebalanceColumn(env: TaskEnv, status: TaskStatus, movedTaskId: string): Promise<string> {
  const { db, organizationId } = env.ctx;
  const tasks = await db.task.findMany({
    where: { organizationId, status, parentTaskId: null, deletedAt: null, id: { not: movedTaskId } },
    orderBy: { rank: "asc" },
    select: { id: true },
  });
  const keys = generateNKeysBetween(null, null, tasks.length + 1);
  for (const [i, t] of tasks.entries()) {
    await db.task.updateMany({ where: { id: t.id, organizationId }, data: { rank: keys[i]! } });
  }
  return keys[keys.length - 1]!;
}

// ---- Bulk --------------------------------------------------------------------------

const bulkIdsSchema = z.array(idSchema).min(1, "Select at least one task.").max(500);

async function loadMany(env: TaskEnv, rawIds: unknown): Promise<Subject[]> {
  const ids = uniq(parse(bulkIdsSchema, rawIds));
  const tasks = await env.ctx.db.task.findMany({
    where: { id: { in: ids }, organizationId: env.ctx.organizationId, deletedAt: null },
    select: subjectSelect,
  });
  if (tasks.length !== ids.length) throw new TaskError("One or more tasks don't exist in this organization.");
  return tasks;
}

function assertAllEditable(env: TaskEnv, tasks: Subject[], verb: string): void {
  const denied = tasks.filter((t) => !canEditTask(env.actor, accessOf(t)));
  if (denied.length > 0) {
    throw new TaskError(
      `You can't ${verb} ${denied.length === tasks.length ? "these tasks" : `${denied.length} of these tasks`}.`,
    );
  }
}

export async function bulkUpdateStatus(
  env: TaskEnv,
  rawIds: unknown,
  status: TaskStatus,
  blockedReason?: string | null,
): Promise<TaskActionResult> {
  const next = parse(z.enum(STATUS_VALUES), status);
  const tasks = await loadMany(env, rawIds);
  assertAllEditable(env, tasks, "change");
  for (const t of tasks) {
    if (t.status === next && next !== TaskStatus.BLOCKED) continue;
    await applyUpdate(env, t, { status: next, blockedReason });
  }
  return {};
}

export const bulkAssignSchema = z.object({
  taskIds: bulkIdsSchema,
  userId: idSchema,
  role: z.enum(["owner", "collaborator"]).default("owner"),
  confirmFlagged: z.boolean().optional(),
});

/**
 * Assigns many tasks to one member through the same checked path as a
 * single edit (every task authorized and classified), with ONE email that
 * lists every title.
 */
export async function bulkAssign(env: TaskEnv, input: unknown): Promise<TaskActionResult> {
  const d = parse(bulkAssignSchema, input);
  const { db, organizationId } = env.ctx;
  if (!env.memberIds.has(d.userId)) throw new TaskError("That user isn't a member of this organization.");
  const tasks = await loadMany(env, d.taskIds);

  const plans = tasks.map((t) => {
    const access = accessOf(t);
    const change: AssignmentChange =
      d.role === "owner" ? { ownerId: d.userId } : { addAssigneeIds: [d.userId] };
    return { task: t, plan: planAssignment(env, access, change) };
  });
  const flagged = plans.flatMap((p) => flaggedAssignments(p.plan));
  if (flagged.length > 0 && !d.confirmFlagged) return confirmationFor(env, flagged);

  const assigned: { id: string; title: string; dueDate: Date | null; flagged: boolean }[] = [];
  for (const { task, plan } of plans) {
    const noOp = !plan.ownerChange && plan.add.length === 0 && plan.remove.length === 0;
    if (noOp) continue;
    await db.task.updateMany({
      where: { id: task.id, organizationId },
      data: { ...ownerUpdateData(env, plan), version: { increment: 1 } },
    });
    await writeAssignees(env, task.id, plan);
    await writeActivity(env, task.id, assignmentActivity(plan));
    await scheduleTaskReminders(db, env.org, task, [d.userId], env.now);
    assigned.push({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate,
      flagged: flaggedAssignments(plan).length > 0,
    });
  }

  if (assigned.length > 0 && d.userId !== env.actor.userId) {
    const anyFlagged = assigned.some((a) => a.flagged);
    const today = localDateKey(env.now, env.org.timezone);
    const single = assigned.length === 1 ? assigned[0]! : null;
    await notifyUsers(db, organizationId, [d.userId], {
      type: anyFlagged ? NotificationType.TASK_FLAGGED : NotificationType.TASK_ASSIGNED,
      title: single
        ? `${actorName(env)} assigned you ${quoted(single.title)}`
        : `${actorName(env)} assigned you ${assigned.length} tasks`,
      // One line per task; the email lists every title.
      body: assigned
        .map((a) => `${a.title}${a.dueDate ? ` (due ${formatDueKey(dueDateKey(a.dueDate), today)})` : ""}`)
        .join("\n")
        .slice(0, 2000),
      linkUrl: single ? taskPath(env.org.slug, single.id) : `/app/${env.org.slug}/tasks?view=mine`,
      taskId: single?.id ?? null,
      actorId: env.actor.userId,
    });
  }
  return {};
}

export async function bulkDelete(env: TaskEnv, rawIds: unknown): Promise<TaskActionResult> {
  const tasks = await loadMany(env, rawIds);
  assertAllEditable(env, tasks, "delete");
  const ids = tasks.map((t) => t.id);
  await env.ctx.db.task.updateMany({
    where: { organizationId: env.ctx.organizationId, OR: [{ id: { in: ids } }, { parentTaskId: { in: ids } }] },
    data: { deletedAt: env.now },
  });
  return {};
}

export async function deleteTask(env: TaskEnv, taskId: string): Promise<TaskActionResult> {
  const s = await loadSubject(env, taskId);
  if (!canEditTask(env.actor, accessOf(s))) throw new TaskError("You can't delete this task.");
  await env.ctx.db.task.updateMany({
    where: { organizationId: env.ctx.organizationId, OR: [{ id: s.id }, { parentTaskId: s.id }] },
    data: { deletedAt: env.now },
  });
  return { taskId: s.id };
}

export async function restoreTask(env: TaskEnv, taskId: string): Promise<TaskActionResult> {
  const s = await loadSubject(env, taskId, true);
  if (!canEditTask(env.actor, accessOf(s))) throw new TaskError("You can't restore this task.");
  await env.ctx.db.task.updateMany({
    where: { organizationId: env.ctx.organizationId, OR: [{ id: s.id }, { parentTaskId: s.id }] },
    data: { deletedAt: null },
  });
  return { taskId: s.id };
}

// ---- Comments ------------------------------------------------------------------------

export const MAX_COMMENT_LENGTH = 10000;
const commentBodySchema = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(MAX_COMMENT_LENGTH, "Keep comments under 10,000 characters.");

export interface CommentResult {
  error?: string;
  commentId?: string;
}

/** Any member may comment on a task they can see. Mentions notify; the owner and collaborators get a comment notice. */
export async function addComment(env: TaskEnv, taskId: string, rawBody: unknown): Promise<CommentResult> {
  const body = parse(commentBodySchema, rawBody);
  const s = await loadSubject(env, taskId);
  const { db, organizationId } = env.ctx;
  const comment = await db.taskComment.create({
    data: { organizationId, taskId: s.id, authorId: env.actor.userId, body },
    select: { id: true },
  });
  await writeActivity(env, s.id, [{ type: "COMMENTED", diffJson: { commentId: comment.id } }]);
  const mentioned = await syncMentions(env, s, comment.id, body);
  const watchers = uniq([...(s.ownerId ? [s.ownerId] : []), ...s.assignees.map((a) => a.userId)]).filter(
    (id) => id !== env.actor.userId && !mentioned.includes(id),
  );
  if (watchers.length > 0) {
    await notifyUsers(db, organizationId, watchers, {
      type: NotificationType.TASK_COMMENTED,
      title: `${actorName(env)} commented on ${quoted(s.title)}`,
      body: mentionsToPlainText(body).replace(/\s+/g, " ").slice(0, 280),
      linkUrl: taskPath(env.org.slug, s.id),
      taskId: s.id,
      actorId: env.actor.userId,
    });
  }
  return { commentId: comment.id };
}

async function loadComment(env: TaskEnv, commentId: string) {
  const comment = await env.ctx.db.taskComment.findFirst({
    where: { id: parse(idSchema, commentId), organizationId: env.ctx.organizationId, deletedAt: null },
    select: { id: true, authorId: true, taskId: true, task: { select: { id: true, title: true, deletedAt: true } } },
  });
  if (!comment || comment.task.deletedAt) throw new TaskError("Comment not found.");
  if (comment.authorId !== env.actor.userId && !env.actor.isAdmin) {
    throw new TaskError("Only the author or an admin can change this comment.");
  }
  return comment;
}

export async function editComment(env: TaskEnv, commentId: string, rawBody: unknown): Promise<CommentResult> {
  const body = parse(commentBodySchema, rawBody);
  const c = await loadComment(env, commentId);
  await env.ctx.db.taskComment.updateMany({
    where: { id: c.id, organizationId: env.ctx.organizationId },
    data: { body, editedAt: env.now },
  });
  await syncMentions(env, c.task, c.id, body);
  return { commentId: c.id };
}

export async function deleteComment(env: TaskEnv, commentId: string): Promise<CommentResult> {
  const c = await loadComment(env, commentId);
  const { db, organizationId } = env.ctx;
  await db.taskComment.updateMany({ where: { id: c.id, organizationId }, data: { deletedAt: env.now } });
  await db.taskMention.deleteMany({ where: { organizationId, taskId: c.taskId, sourceKey: c.id } });
  return { commentId: c.id };
}
