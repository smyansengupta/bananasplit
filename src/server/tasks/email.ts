import { NotificationType, TaskStatus } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import {
  daysBetweenKeys,
  dueDateKey,
  effectiveTimezone,
  formatDueKey,
  isDateKey,
  localDateKey,
} from "@/lib/tasks/dates";
import { withSystemOrgTx } from "@/server/db/context";
import type { RenderedEmail } from "@/server/email/templates";

import { loadDigest } from "./digest";
import {
  digestItemCount,
  taskAssignedEmail,
  taskBulkAssignedEmail,
  taskCommentedEmail,
  taskDigestEmail,
  taskMentionedEmail,
  taskReminderEmail,
  taskRequestFiledEmail,
  weeklyUpdateReminderEmail,
  type TaskFacts,
} from "./email-templates";
import { getWeeklySummary } from "./weekly";

/**
 * Renders the email copy of a task notification for the notify-email job
 * (src/server/email/jobs.ts), so assignment, mention, comment, reminder,
 * digest and Sunday-update mail all ride the one outbox path: the job checks
 * the recipient's preference, routes through getOrgMailer (the org's sender,
 * or the platform fallback) and marks Notification.emailSentAt with a
 * compare-and-set, so each message goes out at most once.
 *
 * Returns null for non-task notifications (the generic template is used),
 * or "skip" when the message no longer applies at send time (the task was
 * deleted, completed before its reminder went out, or the digest is empty).
 * Reads run in one short service transaction; nothing here sends.
 */

export const TASK_NOTIFICATION_TYPES: ReadonlySet<NotificationType> = new Set([
  NotificationType.TASK_ASSIGNED,
  NotificationType.TASK_FLAGGED,
  NotificationType.TASK_MENTIONED,
  NotificationType.TASK_COMMENTED,
  NotificationType.TASK_DUE_REMINDER,
  NotificationType.TASK_DIGEST,
  NotificationType.WEEKLY_UPDATE_REMINDER,
]);

export interface TaskNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  linkUrl: string | null;
  taskId: string | null;
  actorId: string | null;
  dedupeKey: string | null;
}

const PRIORITY_LABELS: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };
const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Completed",
};

export function dueWhen(todayKey: string, dueKey: string): string {
  const days = daysBetweenKeys(todayKey, dueKey);
  if (days < 0) return days === -1 ? "yesterday (overdue)" : `${-days} days ago (overdue)`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export async function renderTaskNotificationEmail(
  organizationId: string,
  n: TaskNotificationInput,
  now: Date = new Date(),
): Promise<RenderedEmail | "skip" | null> {
  if (!TASK_NOTIFICATION_TYPES.has(n.type)) return null;

  return withSystemOrgTx(organizationId, async ({ db }) => {
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, slug: true, timezone: true },
    });
    const recipient = await db.user.findUnique({ where: { id: n.userId }, select: { timezone: true } });
    if (!org || !recipient) return "skip";
    const tz = effectiveTimezone(recipient, org);
    const todayKey = localDateKey(now, tz);
    const actorName = n.actorId
      ? ((await db.user.findUnique({ where: { id: n.actorId }, select: { name: true } }))?.name ?? "A teammate")
      : "A teammate";
    const url = appUrl(n.linkUrl ?? `/app/${org.slug}/tasks?view=mine`);

    if (n.type === NotificationType.TASK_DIGEST) {
      const sections = await loadDigest(db, { organizationId, orgSlug: org.slug, userId: n.userId, now, todayKey });
      if (digestItemCount(sections) === 0) return "skip";
      return taskDigestEmail({
        orgName: org.name,
        dateLabel: formatDueKey(todayKey, todayKey),
        sections,
        url: appUrl(`/app/${org.slug}/tasks?view=mine`),
      });
    }

    if (n.type === NotificationType.WEEKLY_UPDATE_REMINDER) {
      const weekStart = n.dedupeKey?.startsWith("weekly:") ? n.dedupeKey.slice("weekly:".length) : null;
      if (!weekStart || !isDateKey(weekStart)) return "skip";
      const summary = await getWeeklySummary(db, organizationId, n.userId, weekStart, tz, now);
      return weeklyUpdateReminderEmail({
        orgName: org.name,
        weekLabel: formatDueKey(weekStart, todayKey),
        counts: { done: summary.done.length, next: summary.next.length, blocked: summary.blocked.length },
        url: appUrl(`/app/${org.slug}/tasks?view=updates`),
      });
    }

    if (!n.taskId) {
      // A bulk assignment: one message listing every title (one per body line).
      if (n.type === NotificationType.TASK_ASSIGNED || n.type === NotificationType.TASK_FLAGGED) {
        return taskBulkAssignedEmail({
          orgName: org.name,
          actorName,
          items: (n.body ?? "").split("\n").map((l) => l.trim()).filter(Boolean),
          flagged: n.type === NotificationType.TASK_FLAGGED,
          url,
        });
      }
      return null;
    }

    const task = await db.task.findFirst({
      where: { id: n.taskId, organizationId },
      select: {
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        deletedAt: true,
        blockedReason: true,
        ownerId: true,
        project: { select: { name: true } },
        parentTask: { select: { title: true } },
      },
    });
    if (!task || task.deletedAt) return "skip";
    const dueKey = task.dueDate ? dueDateKey(task.dueDate) : null;
    const facts: TaskFacts = {
      title: task.title,
      dueLabel: dueKey ? formatDueKey(dueKey, todayKey) : null,
      priority: PRIORITY_LABELS[task.priority] ?? task.priority,
      projectName: task.project?.name ?? null,
      parentTitle: task.parentTask?.title ?? null,
    };

    switch (n.type) {
      case NotificationType.TASK_ASSIGNED:
      case NotificationType.TASK_FLAGGED: {
        if (n.dedupeKey?.startsWith("intake:")) {
          return taskRequestFiledEmail({ orgName: org.name, actorName, task: facts, url });
        }
        return taskAssignedEmail({
          orgName: org.name,
          actorName,
          role: task.ownerId === n.userId ? "owner" : "collaborator",
          task: facts,
          flagged: n.type === NotificationType.TASK_FLAGGED,
          url,
        });
      }
      case NotificationType.TASK_MENTIONED:
        return taskMentionedEmail({
          orgName: org.name,
          actorName,
          where: n.dedupeKey?.endsWith(":desc") ? "description" : "comment",
          excerpt: n.body,
          task: facts,
          url,
        });
      case NotificationType.TASK_COMMENTED:
        return taskCommentedEmail({ orgName: org.name, actorName, excerpt: n.body, task: facts, url });
      case NotificationType.TASK_DUE_REMINDER: {
        if (task.status === TaskStatus.COMPLETED || !dueKey) return "skip";
        return taskReminderEmail({
          orgName: org.name,
          when: dueWhen(todayKey, dueKey),
          role: task.ownerId === n.userId ? "owner" : "collaborator",
          task: { ...facts, status: STATUS_LABELS[task.status], blockedReason: task.blockedReason },
          url,
        });
      }
      default:
        return null;
    }
  });
}
