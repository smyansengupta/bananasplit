import { NotificationType } from "@/generated/prisma/enums";
import {
  emailEnabledFor,
  parseNotificationPreferences,
  type NotificationPreferences,
  type NotificationPreferencesPatch,
} from "@/lib/notifications/preferences";

/**
 * The Emails step's switches, each a group of notification types (the same
 * User.emailPreferences the profile's Notifications card edits), plus the
 * daily summary (the digest). Client-safe.
 */
export const EMAIL_GROUPS = [
  {
    id: "assigned",
    label: "Tasks assigned to you",
    types: [NotificationType.TASK_ASSIGNED, NotificationType.TASK_FLAGGED],
  },
  {
    id: "due",
    label: "Due date reminders",
    types: [
      NotificationType.TASK_DUE_SOON,
      NotificationType.TASK_DUE_REMINDER,
      NotificationType.TASK_DUE_TODAY,
      NotificationType.TASK_OVERDUE,
    ],
  },
  {
    id: "events",
    label: "Meeting invites, reminders and changes",
    types: [
      NotificationType.EVENT_INVITE,
      NotificationType.EVENT_REMINDER,
      NotificationType.EVENT_UPDATED,
      NotificationType.EVENT_CANCELLED,
    ],
  },
  {
    id: "mentions",
    label: "Mentions, comments and shared notes",
    types: [
      NotificationType.TASK_MENTIONED,
      NotificationType.TASK_COMMENTED,
      NotificationType.NOTE_SHARED,
    ],
  },
] as const;

export type EmailGroupId = (typeof EMAIL_GROUPS)[number]["id"] | "digest";

/** Each switch's state from saved preferences: a group is on when every type in it is. */
export function emailSwitches(preferences: NotificationPreferences): Record<EmailGroupId, boolean> {
  const out = { digest: preferences.digest.enabled } as Record<EmailGroupId, boolean>;
  for (const group of EMAIL_GROUPS) {
    out[group.id] = group.types.every((t) => emailEnabledFor(preferences, t));
  }
  return out;
}

/** The preferences patch for a set of switches. */
export function emailPatch(switches: Record<EmailGroupId, boolean>): NotificationPreferencesPatch {
  const types: Partial<Record<NotificationType, boolean>> = {};
  for (const group of EMAIL_GROUPS) for (const t of group.types) types[t] = switches[group.id];
  return { types, digest: { enabled: switches.digest } };
}

/**
 * Where the Emails step starts from User.emailPreferences: every switch on
 * (the morning summary too) for someone who has never chosen, else what they
 * chose. The switches are account-wide, so a second organization's setup
 * must not turn back on what was switched off before.
 */
export function setupEmailSwitches(saved: unknown): Record<EmailGroupId, boolean> {
  if (saved == null) {
    const on = { digest: true } as Record<EmailGroupId, boolean>;
    for (const group of EMAIL_GROUPS) on[group.id] = true;
    return on;
  }
  return emailSwitches(parseNotificationPreferences(saved));
}
