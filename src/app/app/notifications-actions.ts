"use server";

import { requireUser } from "@/lib/auth/session";
import { getRecentNotifications, getUnreadCount } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

export async function fetchMyNotifications() {
  const user = await requireUser();
  const [notifications, unreadCount] = await Promise.all([
    getRecentNotifications(user.id),
    getUnreadCount(user.id),
  ]);
  return { notifications, unreadCount };
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { id: notificationId, userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
}
