import type { NotificationType } from "@/generated/prisma/enums";

import { isEmailEnabled as isEmailEnabledV2 } from "./notification-prefs";

/**
 * Whether a user's User.emailPreferences allow email for `type`. Reads
 * through the v2 parser (src/lib/notification-prefs.ts), which upgrades the
 * old flat map ({ TASK_DUE_SOON: false }) on read: a type absent from the
 * map is enabled (opt-out), except the daily digest and the types that
 * default off. Pure and client-safe.
 */
export function isEmailEnabled(preferences: unknown, type: NotificationType): boolean {
  return isEmailEnabledV2(preferences, type);
}
