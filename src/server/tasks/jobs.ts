import { randomUUID } from "node:crypto";

import { NotificationType, TaskStatus } from "@/generated/prisma/client";
import { parseNotificationPrefs } from "@/lib/notification-prefs";
import {
  dueDateKey,
  effectiveTimezone,
  formatDueKey,
  fromDateKey,
  localDateKey,
} from "@/lib/tasks/dates";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler, type JobOutcome } from "@/server/jobs/types";
import { notifyUsers } from "@/server/notifications";

import { loadDigest } from "./digest";
import { dueWhen } from "./email";
import { digestItemCount } from "./email-templates";
import { expectedPosters } from "./weekly";

/**
 * Job handlers for the task kinds (registry rows task-reminder, task-digest,
 * weekly-update-reminder). Each runs outside any transaction, re-checks the
 * world in one short withSystemOrgTx, and ends in a Notification plus its
 * notify-email job (the one email path: preference check, org mailer,
 * emailSentAt compare-and-set). A job that no longer applies ends CANCELLED,
 * which leaves its key free to be enqueued again (once=true only refuses a
 * key that finished DONE, i.e. actually notified).
 */

function requireOrg(orgId: string | null): string {
  if (!orgId) throw new PermanentJobError("org job without an organizationId");
  return orgId;
}

function cancelled(reason: string): JobOutcome {
  return { status: "CANCELLED", error: reason };
}

async function isMember(db: TxClient, organizationId: string, userId: string): Promise<boolean> {
  const m = await db.membership.findFirst({
    where: { organizationId, userId },
    select: { id: true },
  });
  return m !== null;
}

/**
 * task-reminder:{taskId}:{dueDate}:{userId}. Sends only when the task is
 * still open, its due date still equals the key's date, and the recipient is
 * still its owner (or an assignee who opted in). The user path never cancels
 * a reminder; a superseded one ends here as CANCELLED.
 */
export const taskReminderJob: JobHandler<{
  taskId: string;
  userId: string;
  dueDate: string;
}> = async (run) => {
  const orgId = requireOrg(run.organizationId);
  const { taskId, userId, dueDate } = run.payload;
  return withSystemOrgTx(orgId, async ({ db }) => {
    const task = await db.task.findFirst({
      where: { id: taskId, organizationId: orgId },
      select: {
        id: true,
        title: true,
        status: true,
        dueDate: true,
        deletedAt: true,
        ownerId: true,
        assignees: { where: { userId }, select: { userId: true } },
        organization: { select: { slug: true, timezone: true } },
      },
    });
    if (!task || task.deletedAt) return cancelled("task is gone");
    if (task.status === TaskStatus.COMPLETED) return cancelled("task is completed");
    if (!task.dueDate || dueDateKey(task.dueDate) !== dueDate) return cancelled("due date changed");
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { timezone: true, emailPreferences: true },
    });
    if (!user || !(await isMember(db, orgId, userId))) return cancelled("no longer a member");
    const isOwner = task.ownerId === userId;
    if (!isOwner) {
      if (task.assignees.length === 0) return cancelled("no longer on the task");
      if (!parseNotificationPrefs(user.emailPreferences).collaboratorReminders) {
        return cancelled("collaborator reminders are off");
      }
    }
    const tz = effectiveTimezone(user, task.organization);
    const today = localDateKey(new Date(), tz);
    await notifyUsers(db, orgId, [userId], {
      type: NotificationType.TASK_DUE_REMINDER,
      title: `Due ${dueWhen(today, dueDate)}: "${task.title.slice(0, 120)}"`,
      body: `Due ${formatDueKey(dueDate, today)}${isOwner ? "" : " (you're involved)"}`,
      linkUrl: `/app/${task.organization.slug}/tasks/${task.id}`,
      taskId: task.id,
      dedupeKey: `reminder:${task.id}:${dueDate}`,
    });
  });
};

/**
 * task-digest:{userId}:{localDate} (once=true). Re-checks that the member
 * still wants the digest, skips an empty day, and records the digest as an
 * already-read Notification (its email copy is the digest).
 */
export const taskDigestJob: JobHandler<{ userId: string; localDate: string }> = async (run) => {
  const orgId = requireOrg(run.organizationId);
  const { userId, localDate } = run.payload;
  return withSystemOrgTx(orgId, async ({ db }) => {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { timezone: true, emailPreferences: true },
    });
    if (!user || !(await isMember(db, orgId, userId))) return cancelled("no longer a member");
    if (!parseNotificationPrefs(user.emailPreferences).digest.enabled)
      return cancelled("digest turned off");
    const org = await db.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { slug: true, timezone: true },
    });
    const now = new Date();
    const todayKey = localDateKey(now, effectiveTimezone(user, org));
    const sections = await loadDigest(db, {
      organizationId: orgId,
      orgSlug: org.slug,
      userId,
      now,
      todayKey,
    });
    if (digestItemCount(sections) === 0) return; // nothing to report today

    const id = randomUUID();
    await db.notification.createMany({
      data: [
        {
          id,
          organizationId: orgId,
          userId,
          type: NotificationType.TASK_DIGEST,
          title: `Your task digest for ${formatDueKey(localDate, todayKey)}`,
          linkUrl: `/app/${org.slug}/tasks?view=mine`,
          dedupeKey: `digest:${localDate}`,
          readAt: now,
        },
      ],
      skipDuplicates: true,
    });
    const created = await db.notification.findFirst({ where: { id }, select: { id: true } });
    if (!created) return; // already sent for this local date
    await enqueueJob(db, {
      orgId,
      kind: "notify-email",
      key: id,
      payload: { notificationId: id },
    });
  });
};

/**
 * weekly-update-reminder:{userId}:{weekStart} (once=true). Sunday evening,
 * to a lead who hasn't posted this week's update.
 */
export const weeklyUpdateReminderJob: JobHandler<{ userId: string; weekStart: string }> = async (
  run,
) => {
  const orgId = requireOrg(run.organizationId);
  const { userId, weekStart } = run.payload;
  return withSystemOrgTx(orgId, async ({ db }) => {
    const posted = await db.weeklyUpdate.findFirst({
      where: {
        organizationId: orgId,
        userId,
        weekStart: fromDateKey(weekStart),
        postedAt: { not: null },
      },
      select: { id: true },
    });
    if (posted) return cancelled("already posted");
    const leads = await expectedPosters(db, orgId);
    if (!leads.some((l) => l.userId === userId)) return cancelled("not expected to post");
    const org = await db.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { slug: true },
    });
    await notifyUsers(db, orgId, [userId], {
      type: NotificationType.WEEKLY_UPDATE_REMINDER,
      title: "Post your Sunday update",
      body: "Done, next and blocked are drafted for you; review them and post.",
      linkUrl: `/app/${org.slug}/tasks?view=updates`,
      dedupeKey: `weekly:${weekStart}`,
    });
  });
};
