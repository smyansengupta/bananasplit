import type { Role } from "@/generated/prisma/enums";
import { can, type Permission } from "@/lib/auth/permissions";

/**
 * The Settings sub-navigation. Each item is shown only to roles holding its
 * permission (the pages re-check on the server; hiding is a convenience).
 */
export interface SettingsNavItem {
  label: string;
  href: string;
  /** Other paths under which this item is active (e.g. invitations under Members). */
  alsoActiveOn?: string[];
}

export interface SettingsSection {
  label: string;
  segment: string;
  /** One line for the Settings overview cards. */
  description: string;
  permission?: Permission;
  alsoActiveOn?: string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    label: "General",
    segment: "general",
    description: "Name, URL, logo and timezone.",
    permission: "settings.view",
  },
  {
    label: "Members",
    segment: "members",
    description: "The roster, roles, titles and invitations.",
    alsoActiveOn: ["invitations"],
  },
  {
    label: "Integrations",
    segment: "integrations",
    description: "Email sender, Claude, Google Calendar, website data and the build hook.",
    permission: "integrations.view",
  },
  {
    label: "Privacy",
    segment: "privacy",
    description: "Ballot privacy, member emails, database visibility and public events.",
    permission: "privacy.write",
  },
  {
    label: "Theme",
    segment: "theme",
    description: "Colors, logo and the light or dark default.",
    permission: "theme.write",
  },
  {
    label: "Notifications",
    segment: "notifications",
    description: "Which notifications also email you.",
  },
  {
    label: "Calendar feed",
    segment: "calendar",
    description: "Your personal .ics subscription link.",
  },
  {
    label: "Labels",
    segment: "labels",
    description: "The shared label palette for tasks.",
    permission: "labels.write",
  },
  {
    label: "Audit log",
    segment: "audit",
    description: "Every settings change: who made it and when.",
    permission: "audit.view",
  },
  {
    label: "Danger zone",
    segment: "danger",
    description: "Export all data, or delete the organization.",
    permission: "org.delete",
  },
];

/** The sections `role` may open. */
export function visibleSettingsSections(role: Role | null): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => !s.permission || can({ role }, s.permission));
}

export function settingsNavItems(orgSlug: string, role: Role | null): SettingsNavItem[] {
  const base = `/app/${orgSlug}/settings`;
  return visibleSettingsSections(role).map((s) => ({
    label: s.label,
    href: `${base}/${s.segment}`,
    alsoActiveOn: s.alsoActiveOn?.map((segment) => `${base}/${segment}`),
  }));
}

/** Whether `item` is active on `pathname` (its page or anything below it). */
export function isSettingsItemActive(item: SettingsNavItem, pathname: string): boolean {
  return [item.href, ...(item.alsoActiveOn ?? [])].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}
