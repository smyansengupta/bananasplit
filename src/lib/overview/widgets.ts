import { parseBoard, type BoardWidget, type WidgetMeta } from "@/lib/boards";

/**
 * The Overview's widgets. Every member builds their own Overview from these
 * (src/lib/boards). Nothing about the organization's money is here: finance
 * lives on the Finance page, for finance roles. "admin" widgets are offered
 * only to owners and admins. "bare" widgets draw their own surface (block
 * cards). The stat strip, Up next and "Get your organization started"
 * aren't widgets: they always head the page (src/app/app/[orgSlug]/page.tsx),
 * so a saved board that still lists them simply drops them. So does one that
 * lists a widget that's gone (Next sign-up, Recent notes, Recent uploads,
 * People: who's in the organization and who comes is on Databases > Reports;
 * The week, recapped: it's in the Inbox's Announcements now).
 */

type OverviewWidgetMeta = WidgetMeta & { admin?: boolean };

export const OVERVIEW_WIDGETS: readonly OverviewWidgetMeta[] = [
  {
    type: "since-you-were-here",
    title: "Since you were here",
    description: "What changed while you were away: new tasks, replies, answers.",
    group: "You",
    icon: "Zap",
    w: 2,
    h: 1,
  },
  {
    type: "waiting-on-you",
    title: "Waiting on you",
    description: "Reviews, answers and replies other people need from you.",
    group: "You",
    icon: "Hourglass",
    w: 2,
    h: 1,
  },
  {
    type: "waiting-on-others",
    title: "Waiting on others",
    description: "What you asked for and haven't heard back on.",
    group: "You",
    icon: "ArrowLeftRight",
    w: 2,
    h: 1,
  },
  {
    type: "my-tasks",
    title: "My tasks",
    description: "Open tasks that are yours, soonest first, with what each is for.",
    group: "You",
    icon: "CheckSquare",
    w: 2,
    h: 1,
  },
  {
    type: "deadlines",
    title: "Deadlines",
    description: "The organization's next due dates, closest first.",
    group: "Calendar",
    icon: "Target",
    w: 1,
    h: 1,
  },
  {
    type: "here-now",
    title: "Here now",
    description: "Who's in the workspace right now, and what they're on.",
    group: "Organization",
    icon: "Users",
    w: 1,
    h: 1,
  },
  {
    type: "week",
    title: "This week",
    description: "The next seven days: events, your deadlines and the busy days.",
    group: "Calendar",
    icon: "CalendarRange",
    w: 4,
    h: null,
  },
  {
    type: "meetings",
    title: "Meetings",
    description: "Meetings coming up, with their agenda and open action items.",
    group: "Calendar",
    icon: "Users",
    w: 2,
    h: 1,
  },
  {
    type: "events",
    title: "Events",
    description: "Events coming up, with sign-ups against the room.",
    group: "Calendar",
    icon: "CalendarDays",
    w: 2,
    h: 1,
  },
  {
    type: "decisions",
    title: "Decisions",
    description: "What the organization decided lately, and where.",
    group: "Organization",
    icon: "ListChecks",
    w: 2,
    h: 1,
  },
  {
    type: "who-owns-what",
    title: "Who owns what",
    description: "Who's carrying which work, and who has room for more.",
    group: "Organization",
    icon: "Handshake",
    w: 2,
    h: 1,
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
    type: "polls",
    title: "Open forms",
    description: "Forms and quick polls still taking answers.",
    group: "Forms and votes",
    icon: "Vote",
    w: 1,
    h: 1,
  },
  {
    type: "votes",
    title: "Votes",
    description: "Member polls still open, and how the vote is going.",
    group: "Forms and votes",
    icon: "ChartBar",
    w: 1,
    h: 1,
  },
  {
    type: "quick-capture",
    title: "Quick capture",
    description: "Jot a task or a note without leaving Home.",
    group: "You",
    icon: "NotebookText",
    w: 1,
    h: 1,
  },
  {
    type: "recent",
    title: "Pick up where you left off",
    description: "What you had open, and what changed since.",
    group: "You",
    icon: "Clock",
    w: 2,
    h: 1,
  },
  {
    type: "pinned",
    title: "Pinned",
    description: "Your pinned pages, notes, files and more, with how each is doing.",
    group: "You",
    icon: "Pin",
    w: 2,
    h: 1,
  },
];

export const OVERVIEW_WIDGET_TYPES = OVERVIEW_WIDGETS.map((w) => w.type);

/** Widgets that belong to an add-on (src/lib/addons.ts), offered only once it's added. */
const ADD_ON_WIDGETS: Partial<Record<string, string>> = { polls: "forms" };

export function overviewWidgetsFor(
  isAdmin: boolean,
  addOns?: readonly string[] | null,
): OverviewWidgetMeta[] {
  return OVERVIEW_WIDGETS.filter((w) => {
    const addOn = ADD_ON_WIDGETS[w.type];
    if (addOn && addOns != null && !addOns.includes(addOn)) return false;
    return isAdmin || !w.admin;
  });
}

/**
 * The Today strip, Up next and the setup checklist always lead and aren't
 * widgets (see page.tsx). Then a board of shapes that fills the four
 * columns: what changed (a rectangle) above the next deadlines, beside your
 * tasks (a big square); who's here beside meetings (rectangles); the next seven days; events beside open forms and votes
 * (squares); the weekly pulse. The week and the pulse fit their content.
 * Waiting on you, Waiting on others, Decisions, Who owns what, Quick
 * capture, Pick up where you left off and Pinned are offered in Add widget,
 * not placed.
 */
const DEFAULT_LAYOUT: readonly BoardWidget[] = [
  { id: "since-you-were-here", type: "since-you-were-here", w: 2, h: 1 },
  { id: "my-tasks", type: "my-tasks", w: 2, h: 2 },
  { id: "deadlines", type: "deadlines", w: 2, h: 1 },
  { id: "here-now", type: "here-now", w: 2, h: 1 },
  { id: "meetings", type: "meetings", w: 2, h: 1 },
  { id: "week", type: "week", w: 4, h: null },
  { id: "events", type: "events", w: 2, h: 1 },
  { id: "polls", type: "polls", w: 1, h: 1 },
  { id: "votes", type: "votes", w: 1, h: 1 },
  { id: "weekly-pulse", type: "weekly-pulse", w: 4, h: null },
];

/**
 * The member's saved Overview, or the default one. A saved board keeps its
 * own order: widgets added since are offered in Add widget, never pushed
 * onto it, and widgets that are gone drop out (parseBoard keeps only known
 * types).
 */
export function resolveOverview(
  saved: unknown,
  isAdmin: boolean,
  addOns?: readonly string[] | null,
): BoardWidget[] {
  const allowed = overviewWidgetsFor(isAdmin, addOns).map((w) => w.type);
  if (saved != null) {
    const parsed = parseBoard(saved, allowed);
    if (parsed) return parsed;
  }
  return DEFAULT_LAYOUT.filter((w) => allowed.includes(w.type));
}
