/**
 * Notification preferences, under the names the Tasks module uses.
 *
 * The one implementation lives in src/lib/notifications/preferences.ts
 * (shape, upgrade parser, per-type metadata and the profile patch). This
 * file re-exports it, so reminders, digests and the profile form always
 * read and write the same stored value.
 */
import { NotificationType } from "@/generated/prisma/enums";
import {
  DEFAULT_OFF_TYPES,
  DIGEST_HOUR_DEFAULT,
  REMINDER_LEAD_DAYS_DEFAULT,
  REMINDER_LEAD_DAYS_MAX,
  defaultNotificationPreferences,
  emailEnabledFor,
  parseNotificationPreferences,
  type NotificationPreferences,
} from "@/lib/notifications/preferences";

export {
  DEFAULT_OFF_TYPES,
  defaultNotificationPreferences,
  emailEnabledFor,
  parseNotificationPreferences,
  type NotificationPreferences,
};

/** Tasks-side aliases. */
export type NotificationPrefs = NotificationPreferences;
export const parseNotificationPrefs = parseNotificationPreferences;
export const defaultNotificationPrefs = defaultNotificationPreferences;
export const DEFAULT_DIGEST_HOUR = DIGEST_HOUR_DEFAULT;
export const DEFAULT_REMINDER_LEAD_DAYS = REMINDER_LEAD_DAYS_DEFAULT;
export const MAX_REMINDER_LEAD_DAYS = REMINDER_LEAD_DAYS_MAX;

/** Raw User.emailPreferences -> whether `type` may be emailed. */
export function isEmailEnabled(raw: unknown, type: NotificationType): boolean {
  return emailEnabledFor(parseNotificationPreferences(raw), type);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  return n < min || n > max ? fallback : n;
}

/**
 * The user's reminder lead in days: their own setting when they saved one
 * (v2), else the org default (OrgSettings.reminderLeadDaysDefault).
 */
export function reminderLeadDaysFor(raw: unknown, orgDefault: number): number {
  if (isRecord(raw) && raw.v === 2 && typeof raw.reminderLeadDays === "number") {
    return parseNotificationPreferences(raw).reminderLeadDays;
  }
  return clampInt(orgDefault, 0, MAX_REMINDER_LEAD_DAYS, DEFAULT_REMINDER_LEAD_DAYS);
}

/** The value to store (always v2, normalized). */
export function serializeNotificationPrefs(prefs: NotificationPrefs): NotificationPrefs {
  const parsed = parseNotificationPreferences(prefs);
  return {
    v: 2,
    types: { ...parsed.types },
    digest: { ...parsed.digest },
    reminderLeadDays: parsed.reminderLeadDays,
    collaboratorReminders: parsed.collaboratorReminders,
  };
}
