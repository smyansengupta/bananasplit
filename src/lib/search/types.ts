import type { SectionId } from "@/lib/nav/sidebar";

/**
 * The shapes workspace search hands the ⌘K palette, and the filters it
 * offers. Client-safe: the palette and src/server/search share them.
 */

export const SEARCH_SCOPES = [
  { id: "all", label: "All" },
  { id: "pages", label: "Pages" },
  { id: "notes", label: "Notes" },
  { id: "files", label: "Files" },
  { id: "tasks", label: "Tasks" },
  { id: "events", label: "Events" },
  { id: "polls", label: "Polls" },
  { id: "people", label: "People" },
  { id: "databases", label: "Databases" },
  { id: "finance", label: "Finance" },
] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number]["id"];

export function isSearchScope(value: unknown): value is SearchScope {
  return SEARCH_SCOPES.some((s) => s.id === value);
}

export type SearchKind =
  | "page"
  | "action"
  | "note"
  | "folder"
  | "file"
  | "task"
  | "project"
  | "label"
  | "event"
  | "poll"
  | "person"
  | "position"
  | "database"
  | "transaction"
  | "sponsor";

/** Groups the server fills; the palette adds "recent", "actions" and "pages" itself. */
export const SERVER_GROUPS = [
  "notes",
  "folders",
  "files",
  "tasks",
  "projects",
  "events",
  "polls",
  "people",
  "roles",
  "databases",
  "finance",
] as const;

export type ServerGroupId = (typeof SERVER_GROUPS)[number];
export type SearchGroupId = ServerGroupId | "recent" | "actions" | "pages";

export const GROUP_LABELS: Record<SearchGroupId, string> = {
  recent: "Recent",
  actions: "Actions",
  pages: "Pages",
  notes: "Notes",
  folders: "Folders",
  files: "Files",
  tasks: "Tasks",
  projects: "Projects and labels",
  events: "Events",
  polls: "Polls",
  people: "People",
  roles: "Org chart",
  databases: "Databases",
  finance: "Finance",
};

/** Which filter chip each group belongs to. */
export const GROUP_SCOPE: Record<SearchGroupId, Exclude<SearchScope, "all">> = {
  recent: "pages",
  actions: "pages",
  pages: "pages",
  notes: "notes",
  folders: "notes",
  files: "files",
  tasks: "tasks",
  projects: "tasks",
  events: "events",
  polls: "polls",
  people: "people",
  roles: "people",
  databases: "databases",
  finance: "finance",
};

/**
 * The sidebar section each group's records live in. A section the org hid
 * (Settings › Sidebar) drops out of members' search, the way its pages show
 * them a notice; owners and admins still find it.
 */
export const GROUP_SECTION: Partial<Record<SearchGroupId, SectionId>> = {
  notes: "notes",
  folders: "notes",
  files: "notes",
  tasks: "tasks",
  projects: "tasks",
  events: "calendar",
  polls: "polls",
  people: "people",
  roles: "org-chart",
  databases: "databases",
  finance: "finance",
};

export interface SearchHit {
  /** Unique across the palette ("note:abc"). */
  key: string;
  kind: SearchKind;
  title: string;
  href: string;
  /** A second line: where the match is, or where the record lives. */
  detail?: string | null;
  /** A short tag on the right: a status, a date, an amount. */
  meta?: string | null;
  /** Higher is better; comparable across groups. */
  score: number;
}

export interface SearchGroup {
  id: SearchGroupId;
  label: string;
  hits: SearchHit[];
  /** The section's own list, filtered to the query ("All notes matching…"). */
  more?: { href: string; label: string } | null;
}

export interface SearchResponse {
  /** The query as the server read it (trimmed), so stale answers can be told apart. */
  query: string;
  scope: SearchScope;
  groups: SearchGroup[];
}
