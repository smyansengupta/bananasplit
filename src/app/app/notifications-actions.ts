"use server";

import { requireUser } from "@/lib/auth/session";
import { withUserTx } from "@/server/db/context";

/**
 * The notification bell: the session user's own notifications across their
 * orgs. Runs in withUserTx (app_user, no org context); the Notification
 * policies show and update only rows whose recipient is app.user_id(), and
 * app_user may update readAt alone.
 */

const RECENT_LIMIT = 20;

export async function fetchMyNotifications() {
  const user = await requireUser();
  return withUserTx(user.id, async ({ db }) => ({
    notifications: await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIMIT,
    }),
    unreadCount: await db.notification.count({ where: { userId: user.id, readAt: null } }),
  }));
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  const user = await requireUser();
  await withUserTx(user.id, ({ db }) =>
    db.notification.updateMany({
      where: { id: notificationId, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    }),
  );
}

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  await withUserTx(user.id, ({ db }) =>
    db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    }),
  );
}
