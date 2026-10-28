import { spaceIncludes, type SpaceInfo } from "@/lib/billing/space";
import { NEW_EVENT_PARAM } from "@/lib/calendar/range";
import { SECTION_FEATURES, type ResolvedGroup } from "@/lib/nav/sidebar";
import { NEW_TASK_PARAM } from "@/lib/shortcuts";

/**
 * The sidebar's links for one space: a club's sections (in the club's
 * order, under its headings, with its names; Admin panel > Sidebar) as
 * plain data the client sidebar can take, or a Personal space's fixed few.
 * The create menu is worked out from the same
 * links, so they only offer what the space has.
 */

export interface NavLink {
  id: string;
  label: string;
  /** The page, sometimes with a query (Personal's Notes and Files share /notes). */
  href: string;
  /** Icon name (@/components/icons). */
  icon: string;
  /** Other pages that belong to this link (People's org chart). */
  also?: string[];
  /**
   * Active only on its own URL (Overview, whose URL is a prefix of every
   * other link's); otherwise also on the pages below it.
   */
  exact: boolean;
  /** Not on the club's plan: the link opens the upgrade screen. */
  locked?: boolean;
}

export interface NavSection {
  id: string;
  label: string | null;
  items: NavLink[];
}

/**
 * A Personal space's sidebar: Home (the Personal dashboard), Tasks,
 * Calendar, Files (notes and uploads together, the one library at /notes),
 * Databases (only the ones you make), Find a time (availability polls anyone
 * answers from a link) and Meetings (its calls, event pages and tickets). No
 * question polls: only members vote on those, and Personal has one. Not
 * arrangeable: there is no team to arrange it for.
 */
export const PERSONAL_NAV: readonly {
  id: string;
  label: string;
  icon: string;
  /** Path (and query) under /app/{slug}. */
  path: string;
  also?: readonly string[];
  exact: boolean;
}[] = [
  { id: "home", label: "Home", icon: "House", path: "", exact: true },
  { id: "tasks", label: "Tasks", icon: "CheckSquare", path: "/tasks", exact: false },
  { id: "calendar", label: "Calendar", icon: "CalendarDays", path: "/calendar", exact: false },
  // Notes and uploads together, as in a club: one library at /notes.
  { id: "notes", label: "Files", icon: "FolderOpen", path: "/notes", exact: false },
  { id: "databases", label: "Databases", icon: "Database", path: "/databases", exact: false },
  {
    id: "find-a-time",
    label: "Find a time",
    icon: "CalendarClock",
    path: "/calendar/find-a-time",
    exact: false,
  },
  { id: "meetings", label: "Meetings", icon: "Video", path: "/meetings", also: ["/calendar/rsvp"], exact: false },
];

/**
 * With a `space`, sections it lacks are left out, or (`showLocked`, for the
 * owner and admins, who can switch plans) kept and marked locked. The
 * Overview is always left out when the space lacks it. A Personal space
 * gets PERSONAL_NAV whatever `groups` says.
 */
export function navSections(
  orgSlug: string,
  groups: readonly ResolvedGroup[],
  options: { space?: SpaceInfo; showLocked?: boolean } = {},
): NavSection[] {
  const { space, showLocked = false } = options;
  if (space?.kind === "PERSONAL") {
    return [
      {
        id: "personal",
        label: null,
        items: PERSONAL_NAV.map((i) => ({
          id: i.id,
          label: i.label,
          href: `/app/${orgSlug}${i.path}`,
          icon: i.icon,
          also: (i.also ?? []).map((p) => `/app/${orgSlug}${p}`),
          exact: i.exact,
        })),
      },
    ];
  }
  return groups
    .map((g) => ({
      id: g.id,
      label: g.label,
      items: g.items.flatMap((i): NavLink[] => {
        const locked = space ? !spaceIncludes(space, SECTION_FEATURES[i.id]) : false;
        if (locked && (!showLocked || i.id === "overview")) return [];
        return [
          {
            id: i.id,
            label: i.label,
            href: `/app/${orgSlug}${i.path}`,
            icon: i.icon,
            also: i.also.map((p) => `/app/${orgSlug}${p}`),
            exact: i.exact,
            ...(locked ? { locked: true } : {}),
          },
        ];
      }),
    }))
    .filter((g) => g.items.length > 0);
}

function splitHref(href: string): { path: string; query: URLSearchParams | null } {
  const at = href.indexOf("?");
  if (at === -1) return { path: href, query: null };
  return { path: href.slice(0, at), query: new URLSearchParams(href.slice(at + 1)) };
}

function matchesPath(path: string, exact: boolean, pathname: string): boolean {
  if (pathname === path) return true;
  if (exact) return false;
  return pathname.startsWith(`${path}/`);
}

/**
 * How closely `link` matches the page: the length of its most specific
 * matching href, or 0. A link with a query (?tab=files) matches when the
 * page's URL agrees with it or doesn't say, and scores a little higher when
 * the URL says the same, so ?tab=files picks Files over Notes.
 */
function matchScore(link: NavLink, pathname: string, search: URLSearchParams): number {
  let best = 0;
  const { path, query } = splitHref(link.href);
  if (matchesPath(path, link.exact, pathname)) {
    let agrees = true;
    let said = false;
    for (const [key, value] of query ?? []) {
      const here = search.get(key);
      if (here === null) continue;
      if (here !== value) agrees = false;
      else said = true;
    }
    if (agrees) best = path.length + (said ? 0.5 : 0);
  }
  for (const href of link.also ?? []) {
    if (matchesPath(href, link.exact, pathname)) best = Math.max(best, href.length);
  }
  return best;
}

/**
 * Whether `link` is the active one on `pathname` (and `search`, the page's
 * query string). When links nest (Polls lives under Calendar), only the
 * most specific match is active; when two match equally (Personal's Notes
 * and Files on a bare /notes), the first one is.
 */
export function isLinkActive(
  link: NavLink,
  pathname: string,
  all: readonly NavLink[],
  search: string | URLSearchParams = "",
): boolean {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const mine = matchScore(link, pathname, params);
  if (mine === 0) return false;
  const scores = all.map((other) => matchScore(other, pathname, params));
  const top = Math.max(0, ...scores);
  if (mine !== top) return mine > top;
  const first = all[scores.indexOf(top)];
  return first.id === link.id && first.href === link.href;
}

/** Whether the page is exactly `href` (path and query), for aria-current="page". */
export function isExactPage(href: string, pathname: string, search: string = ""): boolean {
  const { path, query } = splitHref(href);
  if (path !== pathname) return false;
  const params = new URLSearchParams(search);
  for (const [key, value] of query ?? []) if (params.get(key) !== value) return false;
  return true;
}

export type CreateActionId = "task" | "event" | "meeting" | "note" | "poll" | "find-a-time";

export interface CreateAction {
  id: CreateActionId;
  label: string;
  /** Icon name (@/components/icons). */
  icon: string;
  /** Where it starts; none for a note, which the menu creates and then opens. */
  href?: string;
}

/**
 * The + menu (the tool capsule's):
 * what the viewer can start in this space, from the sections it shows.
 *
 * - New task: Tasks with ?new=1, which starts one there (as `c` does).
 * - New event: the Calendar with ?new=1, which opens the event form; only
 *   for those who may create events.
 * - New meeting: Meetings with ?new=1, which opens the same form there, so a
 *   meeting made from anywhere lands on its own page; only when Meetings is
 *   in the sidebar, and for those who may create events.
 * - New note: a blank private note, made by the menu, then opened.
 * - New poll: Polls' "Ask a question" (clubs only; Personal has no polls).
 * - Find a time: a new availability poll.
 */
export function createActions(
  sections: readonly NavSection[],
  { canCreateEvents }: { canCreateEvents: boolean },
): CreateAction[] {
  const links = new Map(
    sections
      .flatMap((s) => s.items)
      .filter((l) => !l.locked)
      .map((l) => [l.id, l] as const),
  );
  const path = (id: string) => splitHref(links.get(id)!.href).path;
  const actions: CreateAction[] = [];
  if (links.has("tasks")) {
    actions.push({
      id: "task",
      label: "New task",
      icon: "CheckSquare",
      href: `${path("tasks")}?${NEW_TASK_PARAM}=1`,
    });
  }
  if (links.has("calendar") && canCreateEvents) {
    actions.push({
      id: "event",
      label: "New event",
      icon: "CalendarPlus",
      href: `${path("calendar")}?${NEW_EVENT_PARAM}=1`,
    });
  }
  if (links.has("meetings") && canCreateEvents) {
    actions.push({
      id: "meeting",
      label: "New meeting",
      icon: "Video",
      href: `${path("meetings")}?${NEW_EVENT_PARAM}=1`,
    });
  }
  if (links.has("notes")) actions.push({ id: "note", label: "New note", icon: "NotebookPen" });
  if (links.has("polls")) {
    actions.push({ id: "poll", label: "New poll", icon: "Vote", href: `${path("polls")}/ask` });
  }
  if (links.has("find-a-time")) {
    actions.push({
      id: "find-a-time",
      label: "Find a time",
      icon: "CalendarClock",
      href: `${path("find-a-time")}/new`,
    });
  }
  return actions;
}
