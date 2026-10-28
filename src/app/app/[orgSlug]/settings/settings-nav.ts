import type { Role } from "@/generated/prisma/enums";
import { can, type Permission } from "@/lib/auth/permissions";
import type { PlanFeature } from "@/lib/billing/features";
import { spaceIncludes, type SpaceInfo } from "@/lib/billing/space";

/**
 * The Admin panel's navigation (the club's settings; the URL is still
 * /settings). Each item is shown only to roles holding its permission (the
 * pages re-check on the server; hiding is a convenience). A member's own
 * settings (notifications, calendar feed) are on their profile, not here.
 */
export interface SettingsNavItem {
  label: string;
  href: string;
  /** lucide icon name. */
  icon: string;
  group: SettingsGroup;
  /** Other paths under which this item is active (e.g. invitations under Members). */
  alsoActiveOn?: string[];
  /** Not on the club's plan: the page shows the upgrade screen. */
  locked?: boolean;
}

export const SETTINGS_GROUPS = [
  "Organization",
  "People & access",
  "Connections",
  "Records",
] as const;
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
  /** The plan feature the page needs (src/lib/billing/features.ts); none: every plan. */
  feature?: PlanFeature;
  /** Also in a Personal space's settings (General and the danger zone only). */
  personal?: boolean;
  /** The overview card's line in a Personal space, where it differs. */
  personalDescription?: string;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    label: "General",
    segment: "general",
    description: "Organization picture, name, URL and timezone.",
    icon: "Building2",
    group: "Organization",
    permission: "settings.view",
    personal: true,
  },
  {
    label: "Plan and storage",
    segment: "plan",
    description: "Your organization's trial, Team or Team Advanced, and what your files use.",
    personalDescription: "Personal Free or Personal Plus, and what your files use.",
    icon: "Gem",
    group: "Organization",
    permission: "settings.view",
    personal: true,
  },
  {
    label: "Sidebar",
    segment: "sidebar",
    description: "Which sections your organization uses, their order and names.",
    icon: "PanelLeft",
    group: "Organization",
    permission: "settings.view",
    feature: "sidebar",
  },
  {
    label: "Theme",
    segment: "theme",
    description: "Colors, logo and the light or dark default.",
    icon: "Palette",
    group: "Organization",
    permission: "theme.write",
    feature: "themes",
  },
  {
    label: "Weekly pulse",
    segment: "pulse",
    description: "When the organization's weekly recap goes out, to whom, and how.",
    icon: "Activity",
    group: "Organization",
    permission: "settings.view",
    feature: "overview",
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
    feature: "privacy",
  },
  {
    label: "Integrations",
    segment: "integrations",
    description: "Email sender, Claude, Google Calendar, website data and the build hook.",
    icon: "Plug",
    group: "Connections",
    permission: "integrations.view",
    feature: "integrations",
  },
  {
    label: "Audit log",
    segment: "audit",
    description: "Every settings change: who made it and when.",
    icon: "ScrollText",
    group: "Records",
    permission: "audit.view",
    feature: "auditLog",
  },
  {
    label: "Danger zone",
    segment: "danger",
    description: "Export all data, or delete the organization.",
    personalDescription: "Export your data, or delete your Personal space.",
    icon: "TriangleAlert",
    group: "Records",
    permission: "org.delete",
    personal: true,
  },
];

/**
 * The sections `role` may open. In a Personal space (`space.kind`), only
 * those marked `personal`: no members, invitations, plan or team settings.
 */
export function visibleSettingsSections(
  role: Role | null,
  space?: Pick<SpaceInfo, "kind">,
): SettingsSection[] {
  return SETTINGS_SECTIONS.filter(
    (s) =>
      (!s.permission || can({ role }, s.permission)) &&
      (space?.kind !== "PERSONAL" || s.personal === true),
  );
}

/** Whether the space lacks what `section` needs (no space given: nothing is locked). */
export function isSettingsSectionLocked(section: SettingsSection, space?: SpaceInfo): boolean {
  return Boolean(space && section.feature && !spaceIncludes(space, section.feature));
}

export function settingsNavItems(
  orgSlug: string,
  role: Role | null,
  space?: SpaceInfo,
): SettingsNavItem[] {
  const base = `/app/${orgSlug}/settings`;
  return visibleSettingsSections(role, space).map((s) => ({
    label: s.label,
    href: `${base}/${s.segment}`,
    icon: s.icon,
    group: s.group,
    alsoActiveOn: s.alsoActiveOn?.map((segment) => `${base}/${segment}`),
    ...(isSettingsSectionLocked(s, space) ? { locked: true } : {}),
  }));
}

/** Whether `item` is active on `pathname` (its page or anything below it). */
export function isSettingsItemActive(item: SettingsNavItem, pathname: string): boolean {
  return [item.href, ...(item.alsoActiveOn ?? [])].some(
    (href) => pathname === href || pathname.startsWith(`${href}/`),
  );
}
