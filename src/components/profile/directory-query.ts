/**
 * The people directory's state in the URL (?q, team, role, year, free,
 * sort, view, person), so a filtered list or an open profile is a link.
 * Pure and client-safe; the page parses it on the server for the first
 * render and the directory writes it back with history.replaceState.
 */

export const DIRECTORY_SORTS = ["team", "name", "new"] as const;
export type DirectorySort = (typeof DIRECTORY_SORTS)[number];
/** The dense list is the default: the directory is mostly a list of names. */
export const DIRECTORY_VIEWS = ["list", "grid"] as const;
export type DirectoryView = (typeof DIRECTORY_VIEWS)[number];
export const DIRECTORY_ROLES = ["OWNER", "ADMIN", "TREASURER", "MEMBER"] as const;
export type DirectoryRole = (typeof DIRECTORY_ROLES)[number];
/** The team filter for members who are not on the chart. */
export const NO_TEAM_KEY = "none";

export interface DirectoryQuery {
  q: string;
  /** A ChartTeam key, NO_TEAM_KEY, or null for every team. */
  team: string | null;
  role: DirectoryRole | null;
  year: number | null;
  free: boolean;
  sort: DirectorySort;
  view: DirectoryView;
  /** The member whose profile sheet is open. */
  person: string | null;
}

export const EMPTY_QUERY: DirectoryQuery = {
  q: "",
  team: null,
  role: null,
  year: null,
  free: false,
  sort: "team",
  view: "list",
  person: null,
};

type Raw = Record<string, string | string[] | undefined> | URLSearchParams;

function get(raw: Raw, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseDirectoryQuery(raw: Raw): DirectoryQuery {
  const q = (get(raw, "q") ?? "").trim().slice(0, 80);
  const team = get(raw, "team");
  const role = get(raw, "role")?.toUpperCase();
  const year = Number.parseInt(get(raw, "year") ?? "", 10);
  const sort = get(raw, "sort");
  const view = get(raw, "view");
  const person = get(raw, "person");
  return {
    q,
    team: team && ID.test(team) ? team : null,
    role: (DIRECTORY_ROLES as readonly string[]).includes(role ?? "") ? (role as DirectoryRole) : null,
    year: Number.isFinite(year) && year >= 1900 && year <= 2200 ? year : null,
    free: get(raw, "free") === "1",
    sort: (DIRECTORY_SORTS as readonly string[]).includes(sort ?? "") ? (sort as DirectorySort) : "team",
    view: (DIRECTORY_VIEWS as readonly string[]).includes(view ?? "") ? (view as DirectoryView) : "list",
    person: person && ID.test(person) ? person : null,
  };
}

/** The query string for `state` (defaults left out), without the "?". */
export function directorySearch(state: DirectoryQuery): string {
  const p = new URLSearchParams();
  if (state.q) p.set("q", state.q);
  if (state.team) p.set("team", state.team);
  if (state.role) p.set("role", state.role.toLowerCase());
  if (state.year) p.set("year", String(state.year));
  if (state.free) p.set("free", "1");
  if (state.sort !== "team") p.set("sort", state.sort);
  if (state.view !== "list") p.set("view", state.view);
  if (state.person) p.set("person", state.person);
  return p.toString();
}
