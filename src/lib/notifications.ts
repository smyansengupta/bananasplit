import { NotificationType } from "@/generated/prisma/client";
import { sendNotificationEmail } from "@/lib/email";
import { prisma } from "@/lib/prisma";

/**
 * In-app notification center (spec 6.1). Every notification-worthy event in
 * the app should go through this single function — it writes the in-app
 * row and, unless the recipient has opted out for this type, sends the
 * matching email. Callers never need to duplicate the preference check.
 */
export async function notifyUser(params: {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  linkUrl?: string;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      organizationId: params.organizationId,
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      linkUrl: params.linkUrl ?? null,
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { email: true, emailPreferences: true },
  });
  if (!user) return;

  if (!isEmailEnabled(user.emailPreferences, params.type)) return;

  await sendNotificationEmail({
    to: user.email,
    title: params.title,
    body: params.body,
  });
}

/** A type absent from the preferences map is enabled by default (opt-out, not opt-in). */
export function isEmailEnabled(preferences: unknown, type: NotificationType): boolean {
  if (!preferences || typeof preferences !== "object") return true;
  const value = (preferences as Record<string, unknown>)[type];
  return value !== false;
}

export function getUnreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export function getRecentNotifications(userId: string, limit = 20) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
