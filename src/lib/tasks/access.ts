/**
 * Who may change a task: the edit-authorization matrix and the self-assign
 * carve-out ('Tasks owner, status, and mentions' decision). Pure and
 * client-safe: the server enforces it on every path (create, update,
 * reorder, bulk, subtask, restore, delete), the UI uses it to disable
 * controls.
 *
 * Full edit rights: the creator, the owner, an assignee ("also involved"),
 * OWNER/ADMIN, a chart manager of the owner (the owner is in the actor's
 * reporting subtree), and, on an intake request, its triage user.
 *
 * Self-assign carve-out ("Anyone can assign to themselves"): any member may
 * add or remove THEMSELVES as an assignee on any task, and take ownership of
 * a task that has no owner. Nothing else: no title, status or due-date
 * edits, and never removing another owner.
 *
 * Intake projects (Design Requests): anyone files requests, but only the
 * triage user or OWNER/ADMIN sets the priority or the owner, including
 * taking ownership through the carve-out.
 */

export interface TaskAccessSubject {
  createdById: string;
  ownerId: string | null;
  assigneeIds: readonly string[];
  /** The task's project is an intake queue. */
  isIntake: boolean;
  triageUserId: string | null;
}

export interface TaskActor {
  userId: string;
  /** OWNER or ADMIN (permission tasks.manageAll). */
  isAdmin: boolean;
  /** The actor's reporting subtree in the published chart. */
  subtree: readonly string[];
}

export function isChartManagerOf(actor: TaskActor, userId: string | null): boolean {
  return Boolean(userId) && actor.subtree.includes(userId as string);
}

export function canEditTask(actor: TaskActor, task: TaskAccessSubject): boolean {
  return (
    actor.isAdmin ||
    task.createdById === actor.userId ||
    task.ownerId === actor.userId ||
    task.assigneeIds.includes(actor.userId) ||
    isChartManagerOf(actor, task.ownerId) ||
    (task.isIntake && task.triageUserId !== null && task.triageUserId === actor.userId)
  );
}

/** Priority and owner of an intake request: the triage user or OWNER/ADMIN. */
export function canTriage(actor: TaskActor, task: Pick<TaskAccessSubject, "isIntake" | "triageUserId">): boolean {
  return !task.isIntake || actor.isAdmin || (task.triageUserId !== null && task.triageUserId === actor.userId);
}

export interface AssignmentChange {
  /** New owner; undefined leaves it unchanged, null clears it. */
  ownerId?: string | null;
  addAssigneeIds?: readonly string[];
  removeAssigneeIds?: readonly string[];
}

export type AccessCheck = { ok: true; selfAssignOnly: boolean } | { ok: false; reason: string };

const DENY_EDIT = "You can only add or remove yourself on this task.";
const DENY_TRIAGE = "Only the request's triage owner or an admin sets its owner and priority.";

/**
 * Whether `actor` may make `change`. Without full edit rights only the
 * self-assign carve-out applies.
 */
export function checkAssignmentChange(
  actor: TaskActor,
  task: TaskAccessSubject,
  change: AssignmentChange,
): AccessCheck {
  const ownerChanges = change.ownerId !== undefined && change.ownerId !== task.ownerId;
  if (ownerChanges && !canTriage(actor, task)) return { ok: false, reason: DENY_TRIAGE };

  if (canEditTask(actor, task)) return { ok: true, selfAssignOnly: false };

  const adds = change.addAssigneeIds ?? [];
  const removes = change.removeAssigneeIds ?? [];
  if (adds.some((id) => id !== actor.userId) || removes.some((id) => id !== actor.userId)) {
    return { ok: false, reason: DENY_EDIT };
  }
  if (ownerChanges) {
    // Claim an unowned task; never take a task from (or clear) its owner.
    if (task.ownerId !== null || change.ownerId !== actor.userId) {
      return { ok: false, reason: DENY_EDIT };
    }
  }
  return { ok: true, selfAssignOnly: true };
}

/** Plain field edits (title, description, status, due date, labels, project...). */
export function checkFieldEdit(
  actor: TaskActor,
  task: TaskAccessSubject,
  fields: { priority?: boolean },
): AccessCheck {
  if (!canEditTask(actor, task)) return { ok: false, reason: "You can't edit this task." };
  if (fields.priority && !canTriage(actor, task)) return { ok: false, reason: DENY_TRIAGE };
  return { ok: true, selfAssignOnly: false };
}

/** Flags are acknowledged by the flagged person or OWNER/ADMIN. */
export function canAcknowledgeFlag(actor: TaskActor, flaggedUserId: string): boolean {
  return actor.isAdmin || actor.userId === flaggedUserId;
}
