import type { NotificationType } from "@/generated/prisma/enums";
import { emailEnabledFor, parseNotificationPreferences } from "@/lib/notifications/preferences";

/**
 * Whether a user's User.emailPreferences allow email for `type`. Reads
 * through the v2 upgrade parser (src/lib/notifications/preferences.ts), so
 * it understands both the old flat map ({ TASK_DUE_SOON: false }) and v2
 * ({ v: 2, types, digest, reminderLeadDays, collaboratorReminders }). A type
 * absent from the map is enabled (opt-out), except DEFAULT_OFF_TYPES;
 * TASK_DIGEST follows digest.enabled. Pure and client-safe.
 */
export function isEmailEnabled(preferences: unknown, type: NotificationType): boolean {
  return emailEnabledFor(parseNotificationPreferences(preferences), type);
}
