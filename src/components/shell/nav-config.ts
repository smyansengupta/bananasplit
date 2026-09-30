import { type ResolvedGroup } from "@/lib/nav/sidebar";

/**
 * The sidebar's links for one org: its sections (in the org's order, under
 * its headings, with its names; Settings › Sidebar) as plain data the
 * client sidebar can take, plus Settings, which always sits at the bottom.
 */

export interface NavLink {
  id: string;
  label: string;
  href: string;
  /** lucide icon name. */
  icon: string;
  /**
   * Active only on its own URL (Overview, whose URL is a prefix of every
   * other link's); otherwise also on the pages below it.
   */
  exact: boolean;
}

export interface NavSection {
  id: string;
  label: string | null;
  items: NavLink[];
}

export function navSections(orgSlug: string, groups: readonly ResolvedGroup[]): NavSection[] {
  return groups.map((g) => ({
    id: g.id,
    label: g.label,
    items: g.items.map((i) => ({
      id: i.id,
      label: i.label,
      href: `/app/${orgSlug}${i.path}`,
      icon: i.icon,
      exact: i.exact,
    })),
  }));
}

export function settingsLink(orgSlug: string): NavLink {
  return { id: "settings", label: "Settings", href: `/app/${orgSlug}/settings`, icon: "Settings", exact: false };
}

function matches(link: NavLink, pathname: string): boolean {
  if (pathname === link.href) return true;
  if (link.exact) return false;
  return pathname.startsWith(`${link.href}/`);
}

/**
 * Whether `link` is the active one on `pathname`. When links nest (Polls
 * lives under Calendar), only the most specific match is active.
 */
export function isLinkActive(link: NavLink, pathname: string, all: readonly NavLink[]): boolean {
  if (!matches(link, pathname)) return false;
  return !all.some((other) => other.href.length > link.href.length && matches(other, pathname));
}
