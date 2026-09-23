import { NextResponse } from "next/server";

import { notifyUser } from "@/lib/notifications";
import { NotificationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCronAuth } from "@/server/cron/auth";

/**
 * Daily digest: notifies each assignee of tasks due in the next 24 hours
 * (spec 6.1). Meant to be invoked by Vercel Cron — see vercel.json — which
 * only fires once this project is deployed; it never runs on its own in
 * local dev. Fails closed without CRON_SECRET (assertCronAuth). The email
 * copies go through the outbox (notifyUser enqueues notify-email jobs).
 * Phase 6 replaces this cron with per-task reminder jobs.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = assertCronAuth(request);
  if (denied) return denied;

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { not: "COMPLETED" },
      dueDate: { gte: now, lte: tomorrow },
    },
    include: { assignees: { select: { userId: true } } },
  });

  const orgIds = [...new Set(tasks.map((t) => t.organizationId))];
  const orgs = await prisma.organization.findMany({
    where: { id: { in: orgIds } },
    select: { id: true, slug: true },
  });
  const slugByOrgId = new Map(orgs.map((o) => [o.id, o.slug]));

  let notificationsSent = 0;
  for (const task of tasks) {
    const slug = slugByOrgId.get(task.organizationId);
    for (const assignee of task.assignees) {
      await notifyUser({
        organizationId: task.organizationId,
        userId: assignee.userId,
        type: NotificationType.TASK_DUE_SOON,
        title: `"${task.title}" is due tomorrow`,
        linkUrl: slug ? `/app/${slug}/tasks` : undefined,
      });
      notificationsSent += 1;
    }
  }

  return NextResponse.json({ tasksChecked: tasks.length, notificationsSent });
}
