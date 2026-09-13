import {
  CalendarDays,
  CheckSquare,
  LayoutDashboard,
  NotebookText,
  Settings,
  Wallet,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: (orgSlug: string) => string;
  icon: typeof LayoutDashboard;
}

// Every member can at least submit and track their own reimbursements, so
// Finance stays in the nav for everyone; the page behind it (Phase 5) scopes
// down to "My reimbursements" for roles without full finance access.
export const navItems: NavItem[] = [
  { label: "Overview", href: (org) => `/app/${org}`, icon: LayoutDashboard },
  { label: "Tasks", href: (org) => `/app/${org}/tasks`, icon: CheckSquare },
  { label: "Notes", href: (org) => `/app/${org}/notes`, icon: NotebookText },
  { label: "Calendar", href: (org) => `/app/${org}/calendar`, icon: CalendarDays },
  { label: "Finance", href: (org) => `/app/${org}/finance`, icon: Wallet },
  { label: "Settings", href: (org) => `/app/${org}/settings`, icon: Settings },
];
