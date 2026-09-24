import { TaskStatus } from "@/generated/prisma/client";
import { reminderLeadDaysFor } from "@/lib/notification-prefs";
import { addDaysToKey, dueDateKey, effectiveTimezone, zonedInstant } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

/**
 * Due-date reminders ('Background jobs' decision, D2).
 *
 * Creating a task, changing its due date, changing its owner, adding a
 * collaborator or reopening it enqueues one task-reminder job per recipient
 * in the SAME transaction, keyed
 *
 *   task-reminder:{taskId}:{dueDate}:{userId}
 *
 * with runAt = the due date minus the lead (the user's own, else the org
 * default), at 09:00 in the recipient's zone (User.timezone, else the org's).
 *
 * Nothing is ever cancelled from the user path (app.cancel_job is admin- and
 * service-only). A superseded job stays PENDING and ends CANCELLED when it
 * runs, because the worker re-checks that the task is open, that its due date
 * still equals the key's date and that the recipient is still its owner (or
 * an assignee who opted in). Moving a date away and back coalesces into the
 * still-pending job with the same key; once=true refuses a key that already
 * sent (DONE), so a reminder never goes out twice for the same date.
 */

export const REMINDER_HOUR_LOCAL = 9;

export function reminderKey(taskId: string, dueKey: string, userId: string): string {
  return `${taskId}:${dueKey}:${userId}`;
}

export function reminderRunAt(dueKey: string, leadDays: number, tz: string): Date {
  return zonedInstant(addDaysToKey(dueKey, -leadDays), REMINDER_HOUR_LOCAL, tz);
}

export interface ReminderTask {
  id: string;
  dueDate: Date | null;
  status: TaskStatus;
}

export interface ReminderOrg {
  id: string;
  timezone: string;
  reminderLeadDaysDefault: number;
}

/**
 * Enqueues reminders for `userIds` on `task`. Skips when there is no due
 * date, the task is completed, or the reminder time has already passed.
 * Returns the number of jobs enqueued.
 */
export async function scheduleTaskReminders(
  db: TxClient,
  org: ReminderOrg,
  task: ReminderTask,
  userIds: readonly string[],
  now: Date = new Date(),
): Promise<number> {
  if (!task.dueDate || task.status === TaskStatus.COMPLETED) return 0;
  const recipients = [...new Set(userIds)];
  if (recipients.length === 0) return 0;
  const dueKey = dueDateKey(task.dueDate);
  const users = await db.user.findMany({
    where: { id: { in: recipients } },
    select: { id: true, timezone: true, emailPreferences: true },
  });
  let n = 0;
  for (const user of users) {
    const tz = effectiveTimezone(user, org);
    const lead = reminderLeadDaysFor(user.emailPreferences, org.reminderLeadDaysDefault);
    const runAt = reminderRunAt(dueKey, lead, tz);
    if (runAt.getTime() < now.getTime()) continue;
    const id = await enqueueJob(db, {
      orgId: org.id,
      kind: "task-reminder",
      key: reminderKey(task.id, dueKey, user.id),
      payload: { taskId: task.id, userId: user.id, dueDate: dueKey },
      runAt,
      once: true,
    });
    if (id) n += 1;
  }
  return n;
}
