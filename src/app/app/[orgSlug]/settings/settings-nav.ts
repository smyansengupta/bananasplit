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

interface SettingsSection {
  label: string;
  segment: string;
  permission?: Permission;
  alsoActiveOn?: string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { label: "General", segment: "general", permission: "settings.view" },
  { label: "Members", segment: "members", alsoActiveOn: ["invitations"] },
  { label: "Integrations", segment: "integrations", permission: "integrations.view" },
  { label: "Privacy", segment: "privacy", permission: "privacy.write" },
  { label: "Theme", segment: "theme", permission: "theme.write" },
  { label: "Notifications", segment: "notifications" },
  { label: "Calendar feed", segment: "calendar" },
  { label: "Labels", segment: "labels", permission: "labels.write" },
  { label: "Danger zone", segment: "danger", permission: "org.delete" },
];

export function settingsNavItems(orgSlug: string, role: Role | null): SettingsNavItem[] {
  const base = `/app/${orgSlug}/settings`;
  return SETTINGS_SECTIONS.filter((s) => !s.permission || can({ role }, s.permission)).map((s) => ({
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
