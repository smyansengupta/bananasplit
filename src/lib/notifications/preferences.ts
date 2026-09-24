import { z } from "zod";

import { NotificationType } from "@/generated/prisma/enums";

/**
 * Notification preferences, shape v2 (Phase 2 in the spec order; Phase 6
 * reads it for reminders and digests). Stored in User.emailPreferences:
 *
 *   {
 *     v: 2,
 *     types: { [NotificationType]: boolean },   // email on/off per type
 *     digest: { enabled: false, hourLocal: 8 },  // daily task digest
 *     reminderLeadDays: 1,                       // due-date reminder lead
 *   }
 *
 * The old shape was a flat map ({ TASK_DUE_SOON: false }). Every read goes
 * through parseNotificationPreferences(), which upgrades a flat map on the
 * fly and repairs anything malformed field by field, so no migration is
 * needed and a bad value never breaks a page or a job. Writes always store
 * the full v2 object.
 *
 * Semantics:
 * - A type missing from `types` is enabled (opt-out), so adding a new type
 *   never silently unsubscribes anyone.
 * - The daily digest is opt-in: `digest.enabled` defaults to false and is
 *   the only switch for TASK_DIGEST (a missing key must not opt everyone in).
 * - hourLocal is in the user's effective timezone (User.timezone, else the
 *   org's; see src/lib/profile/timezone.ts).
 *
 * Pure and client-safe.
 */

export const NOTIFICATION_TYPES = Object.values(NotificationType) as NotificationType[];

export const DIGEST_HOUR_DEFAULT = 8;
export const REMINDER_LEAD_DAYS_DEFAULT = 1;
export const REMINDER_LEAD_DAYS_MAX = 14;

export const digestHourSchema = z.number().int().min(0).max(23);
export const reminderLeadDaysSchema = z.number().int().min(0).max(REMINDER_LEAD_DAYS_MAX);

/** The stored v2 shape (strict: what every write must satisfy). */
export const notificationPreferencesSchema = z
  .object({
    v: z.literal(2),
    types: z.partialRecord(z.enum(NotificationType), z.boolean()),
    digest: z.object({ enabled: z.boolean(), hourLocal: digestHourSchema }).strict(),
    reminderLeadDays: reminderLeadDaysSchema,
    // Reminders for tasks the user only collaborates on (Tasks): opt-in.
    collaboratorReminders: z.boolean(),
  })
  .strict();

/** Types that stay off until the user turns them on (Tasks). */
export const DEFAULT_OFF_TYPES: ReadonlySet<NotificationType> = new Set([
  NotificationType.TASK_COMMENTED,
]);

export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export type TypePreferences = NotificationPreferences["types"];

export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    v: 2,
    types: {},
    digest: { enabled: false, hourLocal: DIGEST_HOUR_DEFAULT },
    reminderLeadDays: REMINDER_LEAD_DAYS_DEFAULT,
    collaboratorReminders: false,
  };
}

/** Keeps only known NotificationType keys whose value is a boolean. */
function knownTypeBooleans(map: Record<string, unknown>): TypePreferences {
  const out: TypePreferences = {};
  for (const type of NOTIFICATION_TYPES) {
    const value = map[type];
    if (typeof value === "boolean") out[type] = value;
  }
  return out;
}

const objectMap = z.record(z.string(), z.unknown());

/** A v2 value; each field falls back to its default on its own. */
const v2Input = z.object({
  v: z.literal(2),
  types: objectMap.transform(knownTypeBooleans).catch({}),
  digest: z
    .object({
      enabled: z.boolean().catch(false),
      hourLocal: digestHourSchema.catch(DIGEST_HOUR_DEFAULT),
    })
    .catch({ enabled: false, hourLocal: DIGEST_HOUR_DEFAULT }),
  reminderLeadDays: reminderLeadDaysSchema.catch(REMINDER_LEAD_DAYS_DEFAULT),
  collaboratorReminders: z.boolean().catch(false),
});

/** The pre-v2 flat map ({ TASK_DUE_SOON: false }), upgraded. */
const v1Input = objectMap.transform((flat): NotificationPreferences => {
  const types = knownTypeBooleans(flat);
  return {
    ...defaultNotificationPreferences(),
    types,
    // A v1 { TASK_DIGEST: true } counts as opting into the daily digest.
    digest: { enabled: types[NotificationType.TASK_DIGEST] === true, hourLocal: DIGEST_HOUR_DEFAULT },
  };
});

/**
 * The upgrade parser: v2 as is (repaired field by field), a flat v1 map
 * upgraded to v2, anything else (null, arrays, strings) the defaults.
 */
export const notificationPreferencesParser = z
  .union([v2Input, v1Input])
  .transform(
    (value): NotificationPreferences => ({
      v: 2,
      types: value.types,
      digest: { enabled: value.digest.enabled, hourLocal: value.digest.hourLocal },
      reminderLeadDays: value.reminderLeadDays,
      collaboratorReminders: value.collaboratorReminders ?? false,
    }),
  )
  .catch(() => defaultNotificationPreferences());

/** Reads User.emailPreferences in any shape it has ever had. Never throws. */
export function parseNotificationPreferences(raw: unknown): NotificationPreferences {
  return notificationPreferencesParser.parse(raw);
}

/**
 * Whether `type` should also be emailed. TASK_DIGEST follows digest.enabled;
 * DEFAULT_OFF_TYPES stay off until the user opts in; everything else is
 * opt-out.
 */
export function emailEnabledFor(preferences: NotificationPreferences, type: NotificationType): boolean {
  if (type === NotificationType.TASK_DIGEST) {
    return preferences.digest.enabled && preferences.types[type] !== false;
  }
  const explicit = preferences.types[type];
  if (explicit !== undefined) return explicit;
  return !DEFAULT_OFF_TYPES.has(type);
}

/** A partial update from the profile form. */
export const notificationPreferencesPatchSchema = z
  .object({
    types: z.partialRecord(z.enum(NotificationType), z.boolean()).optional(),
    digest: z
      .object({ enabled: z.boolean().optional(), hourLocal: digestHourSchema.optional() })
      .strict()
      .optional(),
    reminderLeadDays: reminderLeadDaysSchema.optional(),
    collaboratorReminders: z.boolean().optional(),
  })
  .strict();

export type NotificationPreferencesPatch = z.infer<typeof notificationPreferencesPatchSchema>;

/** Applies a validated patch; the result is always a complete v2 value. */
export function applyNotificationPreferencesPatch(
  current: NotificationPreferences,
  patch: NotificationPreferencesPatch,
): NotificationPreferences {
  const types: TypePreferences = { ...current.types, ...(patch.types ?? {}) };
  // TASK_DIGEST has one switch: digest.enabled.
  delete types[NotificationType.TASK_DIGEST];
  return notificationPreferencesSchema.parse({
    v: 2,
    types,
    digest: {
      enabled: patch.digest?.enabled ?? current.digest.enabled,
      hourLocal: patch.digest?.hourLocal ?? current.digest.hourLocal,
    },
    reminderLeadDays: patch.reminderLeadDays ?? current.reminderLeadDays,
    collaboratorReminders: patch.collaboratorReminders ?? current.collaboratorReminders,
  });
}

export type NotificationGroup = "tasks" | "events" | "org";

export interface NotificationTypeMeta {
  label: string;
  group: NotificationGroup;
  /** Who normally receives it, when not everyone. */
  audience?: string;
}

/**
 * Labels for the per-type email switches. TASK_DIGEST is not listed: the
 * digest has its own switch and hour.
 */
export const NOTIFICATION_TYPE_META: Record<
  Exclude<NotificationType, "TASK_DIGEST">,
  NotificationTypeMeta
> = {
  TASK_ASSIGNED: { label: "A task is assigned to me", group: "tasks" },
  TASK_MENTIONED: { label: "Someone @mentions me in a task or comment", group: "tasks" },
  TASK_COMMENTED: { label: "Someone comments on a task I own", group: "tasks" },
  TASK_DUE_REMINDER: { label: "A reminder before one of my tasks is due", group: "tasks" },
  TASK_DUE_SOON: { label: "One of my tasks is due soon", group: "tasks" },
  TASK_FLAGGED: {
    label: "A task assignment needs my review",
    group: "tasks",
    audience: "Leads",
  },
  WEEKLY_UPDATE_REMINDER: { label: "Reminder to post my Sunday update", group: "tasks" },
  EVENT_INVITE: { label: "I'm invited to an event", group: "events" },
  EVENT_UPDATED: { label: "An event I'm going to changes", group: "events" },
  EVENT_CANCELLED: { label: "An event I'm going to is cancelled", group: "events" },
  INVITE_ACCEPTED: { label: "Someone accepts an invite I sent", group: "org" },
  INTEGRATION_ERROR: {
    label: "An integration stops working",
    group: "org",
    audience: "Owners and admins",
  },
  SECURITY_ALERT: {
    label: "Security alerts, such as an integration key changing",
    group: "org",
    audience: "Owners",
  },
};

export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroup, string> = {
  tasks: "Tasks",
  events: "Events",
  org: "Organization",
};
