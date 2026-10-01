import { parseBoard, type BoardWidget, type WidgetMeta } from "@/lib/boards";

/**
 * The Overview's widgets. Every member builds their own Overview from these
 * (src/lib/boards). Nothing about the club's money is here: finance lives
 * on the Finance page, for finance roles. "admin" widgets are offered only
 * to owners and admins.
 */

type OverviewWidgetMeta = WidgetMeta & { admin?: boolean };

export const OVERVIEW_WIDGETS: readonly OverviewWidgetMeta[] = [
  { type: "pinned", title: "Pinned", description: "Your pinned pages, notes, files and more.", group: "You", icon: "Pin", w: 4, h: null },
  { type: "my-tasks", title: "My tasks", description: "Open tasks that are yours, soonest first.", group: "You", icon: "CheckSquare", w: 2, h: null },
  { type: "task-stats", title: "My week at a glance", description: "Open, due today, overdue and blocked.", group: "You", icon: "ListChecks", w: 1, h: null },
  { type: "recent", title: "Recently visited", description: "Jump back to what you had open.", group: "You", icon: "Clock", w: 2, h: null },
  { type: "meetings", title: "Meetings", description: "Board and team meetings coming up.", group: "Calendar", icon: "Users", w: 2, h: null },
  { type: "events", title: "Events", description: "Everything else coming up on the calendar.", group: "Calendar", icon: "CalendarDays", w: 2, h: null },
  { type: "week", title: "This week", description: "The next seven days, day by day.", group: "Calendar", icon: "CalendarRange", w: 4, h: null },
  { type: "polls", title: "Open polls", description: "Availability polls still collecting answers.", group: "Calendar", icon: "Vote", w: 1, h: null },
  { type: "notes", title: "Recent notes", description: "Notes edited lately that you can read.", group: "Notes", icon: "NotebookText", w: 2, h: null },
  { type: "files", title: "Recent files", description: "The latest uploads on the Notes page.", group: "Notes", icon: "FolderOpen", w: 2, h: null },
  { type: "people", title: "People", description: "Who's in the club, newest first.", group: "Club", icon: "Users", w: 1, h: null },
  { type: "shortcuts", title: "Shortcuts", description: "One-click links to every section.", group: "Club", icon: "Link2", w: 1, h: null },
  { type: "getting-started", title: "Get your club started", description: "A new club's first steps.", group: "Admin", icon: "Rocket", w: 4, h: null, admin: true },
];

export const OVERVIEW_WIDGET_TYPES = OVERVIEW_WIDGETS.map((w) => w.type);

export function overviewWidgetsFor(isAdmin: boolean): OverviewWidgetMeta[] {
  return OVERVIEW_WIDGETS.filter((w) => isAdmin || !w.admin);
}

const DEFAULT_LAYOUT: readonly BoardWidget[] = [
  { id: "getting-started", type: "getting-started", w: 4, h: null },
  { id: "pinned", type: "pinned", w: 4, h: null },
  { id: "my-tasks", type: "my-tasks", w: 2, h: null },
  { id: "meetings", type: "meetings", w: 2, h: null },
  { id: "events", type: "events", w: 2, h: null },
  { id: "recent", type: "recent", w: 2, h: null },
];

/** The member's saved Overview, or the default one. */
export function resolveOverview(saved: unknown, isAdmin: boolean): BoardWidget[] {
  const allowed = overviewWidgetsFor(isAdmin).map((w) => w.type);
  if (saved != null) {
    const parsed = parseBoard(saved, allowed);
    if (parsed) return parsed;
  }
  return DEFAULT_LAYOUT.filter((w) => allowed.includes(w.type));
}
