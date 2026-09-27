import {
  CalendarCheck,
  CalendarDays,
  ChartColumn,
  CheckSquare,
  Database,
  LayoutDashboard,
  Network,
  NotebookText,
  Settings,
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

// Every member can at least submit and track their own reimbursements, so
// Finance stays in the nav for everyone; the page behind it (Phase 5) scopes
// down to "My reimbursements" for roles without full finance access.
// Only the platform owner of the shell edits this list (CONTRACTS.md);
// feature builders replace their section's stub page instead.
export const navItems: NavItem[] = [
  { label: "Overview", href: (org) => `/app/${org}`, icon: LayoutDashboard, match: "exact" },
  { label: "Tasks", href: (org) => `/app/${org}/tasks`, icon: CheckSquare },
  { label: "Notes", href: (org) => `/app/${org}/notes`, icon: NotebookText },
  { label: "Calendar", href: (org) => `/app/${org}/calendar`, icon: CalendarDays },
  { label: "Polls", href: (org) => `/app/${org}/calendar/polls`, icon: CalendarCheck },
  { label: "Org Chart", href: (org) => `/app/${org}/org-chart`, icon: Network },
  { label: "Databases", href: (org) => `/app/${org}/databases`, icon: Database },
  { label: "Reports", href: (org) => `/app/${org}/reports`, icon: ChartColumn },
  { label: "Finance", href: (org) => `/app/${org}/finance`, icon: Wallet },
  { label: "Settings", href: (org) => `/app/${org}/settings`, icon: Settings },
];

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
