"use server";

import { NotificationType } from "@/generated/prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

const NOTIFICATION_TYPE_VALUES = new Set(Object.values(NotificationType) as string[]);

export async function setEmailPreference(type: string, enabled: boolean): Promise<void> {
  if (!NOTIFICATION_TYPE_VALUES.has(type)) return;

  const user = await requireUser();
  const current = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { emailPreferences: true },
  });
  const preferences =
    current.emailPreferences && typeof current.emailPreferences === "object"
      ? (current.emailPreferences as Record<string, boolean>)
      : {};

  await prisma.user.update({
    where: { id: user.id },
    data: { emailPreferences: { ...preferences, [type]: enabled } },
  });
}
