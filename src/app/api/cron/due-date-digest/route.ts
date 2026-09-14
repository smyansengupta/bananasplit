import { NextResponse } from "next/server";

import { notifyUser } from "@/lib/notifications";
import { NotificationType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Daily digest: notifies each assignee of tasks due in the next 24 hours
 * (spec 6.1). Meant to be invoked by Vercel Cron — see vercel.json — which
 * only fires once this project is deployed; it never runs on its own in
 * local dev.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

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
