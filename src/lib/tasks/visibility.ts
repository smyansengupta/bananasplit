import { TaskVisibility } from "@/generated/prisma/client";

import type { TaskActor } from "./access";

/**
 * Task visibility (C4): an open board with private opt-in.
 *
 * ORG — the default — means every member of the organization sees the task.
 * PRIVATE narrows it to the task's own people:
 *
 *   * its owner
 *   * its collaborators ("also involved")
 *   * its creator
 *   * org OWNER/ADMIN
 *
 * Pure and client-safe. The DATABASE is what actually enforces reads: the
 * app_user SELECT policies on Task and on everything hanging off it call
 * app.can_read_task() (20260924140000_c4_task_visibility). These functions
 * exist so the UI can say who can see a task, disable the controls a person
 * does not have, and keep an @mention inside the audience — never as the
 * only line of defence.
 *
 * Two rules worth stating out loud, because they are product decisions
 * rather than consequences of the schema:
 *
 * 1. A subtask always carries its parent's visibility. You cannot make one
 *    subtask of a private task public, or vice versa; the parent decides for
 *    the whole tree, and a database trigger keeps them equal.
 *
 * 2. Who may FLIP the flag is narrower than who may edit the task. A
 *    collaborator can edit a private task but cannot publish it: only the
 *    owner, the creator or an OWNER/ADMIN changes visibility. Otherwise
 *    adding one collaborator would hand them the power to expose the thing
 *    you made private.
 */

export { TaskVisibility };

export interface TaskVisibilitySubject {
  visibility: TaskVisibility;
  ownerId: string | null;
  createdById: string;
  assigneeIds: readonly string[];
}

export function isPrivate(task: Pick<TaskVisibilitySubject, "visibility">): boolean {
  return task.visibility === TaskVisibility.PRIVATE;
}

/**
 * Everyone named ON the task: its owner, its collaborators and its creator.
 * OWNER/ADMIN also see it but are not listed here — they are a standing
 * audience, not people someone put on this task.
 */
export function namedAudienceIds(task: TaskVisibilitySubject): string[] {
  return [
    ...new Set([...(task.ownerId ? [task.ownerId] : []), ...task.assigneeIds, task.createdById]),
  ];
}

/** Mirrors the RLS predicate. */
export function canSeeTask(actor: TaskActor, task: TaskVisibilitySubject): boolean {
  if (!isPrivate(task)) return true;
  return actor.isAdmin || namedAudienceIds(task).includes(actor.userId);
}

/** The owner, the creator or an OWNER/ADMIN — not a mere collaborator. */
export function canChangeVisibility(actor: TaskActor, task: TaskVisibilitySubject): boolean {
  return actor.isAdmin || task.ownerId === actor.userId || task.createdById === actor.userId;
}

export const VISIBILITY_DENIED =
  "Only this task's owner, its creator or an admin can change who can see it.";

/**
 * Who may be @mentioned. On an open task: anybody in the org. On a private
 * one: only people who already see it, so a mention can never reveal a title
 * to somebody outside the audience. Add them as a collaborator first.
 */
export function mentionableIds(
  task: TaskVisibilitySubject,
  members: readonly { id: string; role?: string | null }[],
  adminIds: readonly string[],
): string[] {
  if (!isPrivate(task)) return members.map((m) => m.id);
  const allowed = new Set([...namedAudienceIds(task), ...adminIds]);
  return members.filter((m) => allowed.has(m.id)).map((m) => m.id);
}

export const MENTION_OUTSIDE_AUDIENCE =
  "Only people who can see this private task can be mentioned on it.";
