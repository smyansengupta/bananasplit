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
  /** Icon name (@/components/icons). */
  icon: string;
  /** Other paths under which this item is active (e.g. invitations under Members). */
  alsoActiveOn?: string[];
  /** Not on the club's plan: the page shows the upgrade screen. */
  locked?: boolean;
}

export interface SettingsSection {
  label: string;
  segment: string;
  /** One line for the command palette. */
  description: string;
  icon: string;
  permission?: Permission;
  alsoActiveOn?: string[];
  /** The plan feature the page needs (src/lib/billing/features.ts); none: every plan. */
  feature?: PlanFeature;
  /** Also in a Personal space's settings (General and the danger zone only). */
  personal?: boolean;
}

/**
 * One flat list, no group headings: the panel opens on General (the old
 * tile overview repeated this list). Weekly pulse lives in General's
 * Schedule card and Storage on the Plan page; their old URLs redirect.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    label: "General",
    segment: "general",
    description: "Picture, name, URL, timezone and schedule.",
    icon: "Building2",
    permission: "settings.view",
    personal: true,
    alsoActiveOn: ["pulse"],
  },
  {
    label: "Plan",
    segment: "plan",
    description: "Plan and storage.",
    icon: "Gem",
    permission: "settings.view",
    personal: true,
  },
  {
    label: "Sidebar",
    segment: "sidebar",
    description: "Sections, order and names.",
    icon: "PanelLeft",
    permission: "settings.view",
    feature: "sidebar",
  },
  {
    label: "Theme",
    segment: "theme",
    description: "Colors, logo and light or dark.",
    icon: "Palette",
    permission: "theme.write",
    feature: "themes",
  },
  {
    label: "Members",
    segment: "members",
    description: "Roles, titles and invites.",
    icon: "Users",
    alsoActiveOn: ["invitations"],
  },
  {
    label: "Privacy",
    segment: "privacy",
    description: "Ballots, emails, databases and the public feed.",
    icon: "ShieldCheck",
    permission: "privacy.write",
    feature: "privacy",
  },
  {
    label: "Integrations",
    segment: "integrations",
    description: "Email, Claude, Google Calendar and website data.",
    icon: "Plug",
    permission: "integrations.view",
    feature: "integrations",
  },
  {
    label: "Audit log",
    segment: "audit",
    description: "Who changed what, and when.",
    icon: "ScrollText",
    permission: "audit.view",
    feature: "auditLog",
  },
  {
    label: "Danger zone",
    segment: "danger",
    description: "Export everything, or delete.",
    icon: "TriangleAlert",
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
