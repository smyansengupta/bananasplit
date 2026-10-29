import { parseBoard, type BoardWidget, type WidgetMeta } from "@/lib/boards";

/**
 * The Overview's widgets. Every member builds their own Overview from these
 * (src/lib/boards). Nothing about the club's money is here: finance lives
 * on the Finance page, for finance roles. "admin" widgets are offered only
 * to owners and admins. "bare" widgets draw their own surface (block cards).
 * The stat strip, Up next and "Get your club started" aren't widgets: they
 * always head the page (src/app/app/[orgSlug]/page.tsx), so a saved board
 * that still lists them simply drops them.
 */

type OverviewWidgetMeta = WidgetMeta & { admin?: boolean };

export const OVERVIEW_WIDGETS: readonly OverviewWidgetMeta[] = [
  {
    type: "pinned",
    title: "Pinned",
    description: "Your pinned pages, notes, files and more.",
    group: "You",
    icon: "Pin",
    w: 4,
    h: null,
  },
  {
    type: "my-tasks",
    title: "My tasks",
    description: "Open tasks that are yours, soonest first.",
    group: "You",
    icon: "CheckSquare",
    w: 2,
    h: null,
  },
  {
    type: "recent",
    title: "Recently visited",
    description: "Jump back to what you had open.",
    group: "You",
    icon: "Clock",
    w: 2,
    h: null,
  },
  {
    type: "meetings",
    title: "Meetings",
    description: "Board and team meetings coming up.",
    group: "Calendar",
    icon: "Users",
    w: 2,
    h: null,
  },
  {
    type: "events",
    title: "Events",
    description: "Everything else coming up on the calendar.",
    group: "Calendar",
    icon: "CalendarDays",
    w: 2,
    h: null,
  },
  {
    type: "rsvp-goal",
    title: "Next RSVP event",
    description: "Seats taken for the next event with a capacity.",
    group: "Calendar",
    icon: "Ticket",
    w: 1,
    h: null,
    frame: "bare",
  },
  {
    type: "week",
    title: "This week",
    description: "The next seven days, day by day.",
    group: "Calendar",
    icon: "CalendarRange",
    w: 4,
    h: null,
  },
  {
    type: "polls",
    title: "Open polls",
    description: "Questions and find-a-time polls still taking answers.",
    group: "Calendar",
    icon: "Vote",
    w: 1,
    h: null,
  },
  {
    type: "weekly-pulse",
    title: "Weekly pulse",
    description: "The latest weekly recap and tasks finished week by week.",
    group: "Organization",
    icon: "Activity",
    w: 4,
    h: null,
  },
  {
    type: "notes",
    title: "Recent notes",
    description: "Notes edited lately that you can read.",
    group: "Files",
    icon: "NotebookText",
    w: 2,
    h: null,
  },
  {
    type: "files",
    title: "Recent uploads",
    description: "The latest uploads in Files.",
    group: "Files",
    icon: "FolderOpen",
    w: 2,
    h: null,
  },
  {
    type: "people",
    title: "People",
    description: "Who's in the organization, newest first.",
    group: "Organization",
    icon: "Users",
    w: 1,
    h: null,
  },
  {
    type: "shortcuts",
    title: "Shortcuts",
    description: "One-click links to every section.",
    group: "Organization",
    icon: "Link2",
    w: 1,
    h: null,
  },
];

export const OVERVIEW_WIDGET_TYPES = OVERVIEW_WIDGETS.map((w) => w.type);

export function overviewWidgetsFor(isAdmin: boolean): OverviewWidgetMeta[] {
  return OVERVIEW_WIDGETS.filter((w) => isAdmin || !w.admin);
}

/**
 * Up next always leads, under the stat strip, and isn't a widget (nor is
 * the stat strip or "Get your club started"; see page.tsx). Then rows that
 * each fill the four columns: your work and what's waiting on an answer
 * (my tasks, the next RSVP event, open polls), the club's next seven days,
 * the weekly pulse, and where you were beside what you pinned. Meetings and
 * Events feed Up next, so they're offered, not placed.
 */
const DEFAULT_LAYOUT: readonly BoardWidget[] = [
  { id: "my-tasks", type: "my-tasks", w: 2, h: null },
  { id: "rsvp-goal", type: "rsvp-goal", w: 1, h: null },
  { id: "polls", type: "polls", w: 1, h: null },
  { id: "week", type: "week", w: 4, h: null },
  { id: "weekly-pulse", type: "weekly-pulse", w: 4, h: null },
  { id: "recent", type: "recent", w: 2, h: null },
  { id: "pinned", type: "pinned", w: 2, h: null },
];

/**
 * The member's saved Overview, or the default one. A saved board keeps its
 * own order: widgets added since (Weekly pulse) are offered in Add widget,
 * never pushed onto it.
 */
export function resolveOverview(saved: unknown, isAdmin: boolean): BoardWidget[] {
  const allowed = overviewWidgetsFor(isAdmin).map((w) => w.type);
  if (saved != null) {
    const parsed = parseBoard(saved, allowed);
    if (parsed) return parsed;
  }
  return DEFAULT_LAYOUT.filter((w) => allowed.includes(w.type));
}
