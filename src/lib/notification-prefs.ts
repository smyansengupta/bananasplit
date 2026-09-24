import { NotificationType } from "@/generated/prisma/enums";

/**
 * Notification preferences, version 2 (User.emailPreferences).
 *
 *   { v: 2,
 *     types: { [NotificationType]: boolean },   // email on/off per type
 *     digest: { enabled: false, hourLocal: 8 }, // the daily task digest
 *     reminderLeadDays: 1,                      // due-date reminder lead
 *     collaboratorReminders: false }            // reminders on tasks I'm only involved in
 *
 * Profiles (Phase 2) owns the UI and writes this shape; Tasks (Phase 6)
 * reads it in every email handler. Reads upgrade anything older on the fly:
 *
 * - v1 was a flat map { TASK_DUE_SOON: false }. Its keys move into `types`.
 * - A type missing from `types` is ON (opt-out), except the types listed in
 *   DEFAULT_OFF_TYPES. The digest is OFF until the user turns it on: a
 *   missing key must never opt every user into a daily email.
 * - An explicit false always stays off.
 * - A legacy writer that spread a flat key onto a v2 object ({v:2, ...,
 *   TASK_ASSIGNED: false}) wins over `types` for that key: it is the newer
 *   intent.
 *
 * Pure and client-safe.
 */

export interface NotificationPrefs {
  v: 2;
  types: Partial<Record<NotificationType, boolean>>;
  digest: { enabled: boolean; hourLocal: number };
  reminderLeadDays: number;
  collaboratorReminders: boolean;
}

export const DEFAULT_DIGEST_HOUR = 8;
export const DEFAULT_REMINDER_LEAD_DAYS = 1;
export const MAX_REMINDER_LEAD_DAYS = 14;

/** Types whose email is off unless the user turns it on. */
export const DEFAULT_OFF_TYPES: ReadonlySet<NotificationType> = new Set([
  NotificationType.TASK_COMMENTED,
]);

const TYPE_NAMES = new Set<string>(Object.values(NotificationType));

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readTypes(source: Record<string, unknown>, into: NotificationPrefs["types"]): void {
  for (const [key, value] of Object.entries(source)) {
    if (TYPE_NAMES.has(key) && typeof value === "boolean") {
      into[key as NotificationType] = value;
    }
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  return n < min || n > max ? fallback : n;
}

export function defaultNotificationPrefs(): NotificationPrefs {
  return {
    v: 2,
    types: {},
    digest: { enabled: false, hourLocal: DEFAULT_DIGEST_HOUR },
    reminderLeadDays: DEFAULT_REMINDER_LEAD_DAYS,
    collaboratorReminders: false,
  };
}

/** Any stored value (v1 flat map, v2, garbage) -> a complete v2 object. */
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  const prefs = defaultNotificationPrefs();
  if (!isRecord(raw)) return prefs;

  if (raw.v === 2) {
    if (isRecord(raw.types)) readTypes(raw.types, prefs.types);
    if (isRecord(raw.digest)) {
      prefs.digest.enabled = raw.digest.enabled === true;
      prefs.digest.hourLocal = clampInt(raw.digest.hourLocal, 0, 23, DEFAULT_DIGEST_HOUR);
    }
    prefs.reminderLeadDays = clampInt(
      raw.reminderLeadDays,
      0,
      MAX_REMINDER_LEAD_DAYS,
      DEFAULT_REMINDER_LEAD_DAYS,
    );
    prefs.collaboratorReminders = raw.collaboratorReminders === true;
  }
  // v1 keys, or flat keys a legacy writer spread onto a v2 object.
  readTypes(raw, prefs.types);
  // The digest is its own switch; a v1 { TASK_DIGEST: true } counts as opting in.
  if (prefs.types.TASK_DIGEST === true && raw.v !== 2) prefs.digest.enabled = true;
  return prefs;
}

/** Whether `type` may be emailed under `prefs` (already parsed or raw). */
export function emailEnabledFor(prefs: NotificationPrefs, type: NotificationType): boolean {
  if (type === NotificationType.TASK_DIGEST) {
    return prefs.digest.enabled && prefs.types.TASK_DIGEST !== false;
  }
  const explicit = prefs.types[type];
  if (explicit !== undefined) return explicit;
  return !DEFAULT_OFF_TYPES.has(type);
}

/** Raw User.emailPreferences -> whether `type` may be emailed. */
export function isEmailEnabled(raw: unknown, type: NotificationType): boolean {
  return emailEnabledFor(parseNotificationPrefs(raw), type);
}

/**
 * The user's reminder lead in days: their own setting when they saved one
 * (v2), else the org default (OrgSettings.reminderLeadDaysDefault).
 */
export function reminderLeadDaysFor(raw: unknown, orgDefault: number): number {
  if (isRecord(raw) && raw.v === 2 && typeof raw.reminderLeadDays === "number") {
    return parseNotificationPrefs(raw).reminderLeadDays;
  }
  return clampInt(orgDefault, 0, MAX_REMINDER_LEAD_DAYS, DEFAULT_REMINDER_LEAD_DAYS);
}

/** The value to store (always v2, normalized). */
export function serializeNotificationPrefs(prefs: NotificationPrefs): NotificationPrefs {
  const parsed = parseNotificationPrefs(prefs);
  return {
    v: 2,
    types: { ...parsed.types },
    digest: { ...parsed.digest },
    reminderLeadDays: parsed.reminderLeadDays,
    collaboratorReminders: parsed.collaboratorReminders,
  };
}
