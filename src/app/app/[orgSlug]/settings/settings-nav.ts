import type { Role } from "@/generated/prisma/enums";
import { can, type Permission } from "@/lib/auth/permissions";

/**
 * The Settings sub-navigation. Each item is shown only to roles holding its
 * permission (the pages re-check on the server; hiding is a convenience).
 */
export interface SettingsNavItem {
  label: string;
  href: string;
  /** lucide icon name. */
  icon: string;
  group: SettingsGroup;
  /** Other paths under which this item is active (e.g. invitations under Members). */
  alsoActiveOn?: string[];
}

export const SETTINGS_GROUPS = ["Organization", "People & access", "Connections", "You", "Admin"] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];

export interface SettingsSection {
  label: string;
  segment: string;
  /** One line for the Settings overview cards. */
  description: string;
  icon: string;
  group: SettingsGroup;
  permission?: Permission;
  alsoActiveOn?: string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    label: "General",
    segment: "general",
    description: "Club picture, name, URL and timezone.",
    icon: "Building2",
    group: "Organization",
    permission: "settings.view",
  },
  {
    label: "Sidebar",
    segment: "sidebar",
    description: "Which sections your club uses, their order and names.",
    icon: "PanelLeft",
    group: "Organization",
    permission: "settings.view",
  },
  {
    label: "Theme",
    segment: "theme",
    description: "Colors, logo and the light or dark default.",
    icon: "Palette",
    group: "Organization",
    permission: "theme.write",
  },
  {
    label: "Labels",
    segment: "labels",
    description: "The shared label palette for tasks.",
    icon: "Tags",
    group: "Organization",
    permission: "labels.write",
  },
  {
    label: "Members",
    segment: "members",
    description: "The roster, roles, titles and invitations.",
    icon: "Users",
    group: "People & access",
    alsoActiveOn: ["invitations"],
  },
  {
    label: "Privacy",
    segment: "privacy",
    description: "Ballot privacy, member emails, database visibility and public events.",
    icon: "ShieldCheck",
    group: "People & access",
    permission: "privacy.write",
  },
  {
    label: "Integrations",
    segment: "integrations",
    description: "Email sender, Claude, Google Calendar, website data and the build hook.",
    icon: "Plug",
    group: "Connections",
    permission: "integrations.view",
  },
  {
    label: "Notifications",
    segment: "notifications",
    description: "Which notifications also email you.",
    icon: "Bell",
    group: "You",
  },
  {
    label: "Calendar feed",
    segment: "calendar",
    description: "Your personal .ics subscription link.",
    icon: "CalendarSync",
    group: "You",
  },
  {
    label: "Audit log",
    segment: "audit",
    description: "Every settings change: who made it and when.",
    icon: "ScrollText",
    group: "Admin",
    permission: "audit.view",
  },
  {
    label: "Danger zone",
    segment: "danger",
    description: "Export all data, or delete the organization.",
    icon: "TriangleAlert",
    group: "Admin",
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
    icon: s.icon,
    group: s.group,
    alsoActiveOn: s.alsoActiveOn?.map((segment) => `${base}/${segment}`),
  }));
}

/** Whether `item` is active on `pathname` (its page or anything below it). */
export function isSettingsItemActive(item: SettingsNavItem, pathname: string): boolean {
  return [item.href, ...(item.alsoActiveOn ?? [])].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}
