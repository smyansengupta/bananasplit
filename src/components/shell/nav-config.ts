import {
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  Database,
  LayoutDashboard,
  Network,
  NotebookText,
  Settings,
  Users,
  Wallet,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: (orgSlug: string) => string;
  icon: typeof LayoutDashboard;
  /**
   * "exact": active only on the item's own URL (Overview, whose URL is a
   * prefix of every other item's). "prefix" (default): also active on any
   * page below it, e.g. Tasks on /tasks/abc and Settings on /settings/members.
   */
  match?: "exact" | "prefix";
}

export interface NavGroup {
  /** Shown above the group; null for the first, unlabelled group. */
  label: string | null;
  items: NavItem[];
}

// Grouped so the sidebar reads as three short lists: your work, the club,
// and its data. Reports lives inside Databases (a tab there); Polls stays
// its own item. Every member can at least submit and track their own
// reimbursements, so Finance stays in the nav for everyone; the page behind
// it scopes down to "My reimbursements" for roles without finance access.
// Settings sits apart at the bottom of the sidebar.
export const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { label: "Overview", href: (org) => `/app/${org}`, icon: LayoutDashboard, match: "exact" },
      { label: "Tasks", href: (org) => `/app/${org}/tasks`, icon: CheckSquare },
      { label: "Calendar", href: (org) => `/app/${org}/calendar`, icon: CalendarDays },
      { label: "Notes", href: (org) => `/app/${org}/notes`, icon: NotebookText },
    ],
  },
  {
    label: "Club",
    items: [
      { label: "People", href: (org) => `/app/${org}/people`, icon: Users },
      { label: "Org Chart", href: (org) => `/app/${org}/org-chart`, icon: Network },
      { label: "Polls", href: (org) => `/app/${org}/calendar/polls`, icon: CalendarCheck },
    ],
  },
  {
    label: "Data",
    items: [
      { label: "Databases", href: (org) => `/app/${org}/databases`, icon: Database },
      { label: "Finance", href: (org) => `/app/${org}/finance`, icon: Wallet },
    ],
  },
];

export const settingsNavItem: NavItem = {
  label: "Settings",
  href: (org) => `/app/${org}/settings`,
  icon: Settings,
};

/** Every item, in sidebar order (Settings last). */
export const navItems: NavItem[] = [...navGroups.flatMap((g) => g.items), settingsNavItem];

function matchesPath(item: NavItem, orgSlug: string, pathname: string): boolean {
  const href = item.href(orgSlug);
  if (pathname === href) return true;
  if (item.match === "exact") return false;
  return pathname.startsWith(`${href}/`);
}

/**
 * Whether `item` is the active nav item on `pathname`. When items nest
 * (Polls lives under Calendar), only the most specific match is active.
 */
export function isNavItemActive(
  item: NavItem,
  orgSlug: string,
  pathname: string,
  items: readonly NavItem[] = navItems,
): boolean {
  if (!matchesPath(item, orgSlug, pathname)) return false;
  const length = item.href(orgSlug).length;
  return !items.some(
    (other) => other.href(orgSlug).length > length && matchesPath(other, orgSlug, pathname),
  );
}
