/**
 * What an in-app address is, for pins and "Recently visited": a label for
 * the fixed pages, or the record whose name the server looks up (a note's
 * title, a folder's name, a database's name...). Pure and client-safe:
 * src/server/pins resolves the lookups under RLS, so a label never leaks
 * something the viewer cannot open.
 *
 * A few views live in the query string (a Notes folder, the Files tab, a
 * Tasks layout); those query parameters are kept, in a fixed order, so the
 * same view always has the same address and can be pinned. Everything else
 * in a query string is dropped.
 */

export const PIN_KINDS = [
  "page",
  "note",
  "task",
  "event",
  "database",
  "person",
  "file",
  "folder",
] as const;
export type PinKind = (typeof PIN_KINDS)[number];

export type PageLookup =
  | { type: "note"; id: string }
  | { type: "task"; id: string }
  | { type: "event"; id: string }
  | { type: "poll"; id: string }
  | { type: "database"; key: string }
  | { type: "person"; id: string }
  | { type: "file"; id: string }
  | { type: "folder"; id: string };

export interface PageInfo {
  /** The in-app address: the path plus any kept view parameters. */
  href: string;
  kind: PinKind;
  /** The label for fixed pages; the fallback while a lookup resolves. */
  label: string;
  lookup?: PageLookup;
  /** Appended to a looked-up label ("Minutes · Files"). */
  suffix?: string;
  /** Pages not worth listing under "Recently visited" (the Overview itself). */
  skipRecent?: boolean;
}

const SECTIONS: Record<string, string> = {
  tasks: "Tasks",
  notes: "Notes",
  calendar: "Calendar",
  databases: "Databases",
  finance: "Finance",
  "org-chart": "Org chart",
  people: "People",
  profile: "Your profile",
  reports: "Reports",
  settings: "Settings",
  setup: "Setup",
};

const SUBPAGES: Record<string, string> = {
  "calendar/polls": "Polls",
  "calendar/polls/ask": "Ask a question",
  "calendar/polls/new": "New poll",
  "calendar/sync": "Calendar sync",
  "databases/reports": "Reports",
  "finance/budget": "Budget",
  "finance/my-reimbursements": "My reimbursements",
  "finance/sponsorships": "Sponsorships",
  "finance/transactions": "Transactions",
  "org-chart/import": "Import org chart",
  "org-chart/versions": "Org chart history",
  "setup/status": "Setup status",
};

export const TASK_VIEWS: Record<string, string> = {
  week: "Week",
  board: "Board",
  table: "Table",
  calendar: "Calendar",
  team: "Team",
  updates: "Sunday update",
  intake: "Requests",
};

const TASK_SCOPES: Record<string, string> = { mine: "Mine", team: "My team", all: "Everyone" };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The view parameters kept for a section, in a fixed order. */
function keptQuery(section: string, parts: string[], search: URLSearchParams): [string, string][] {
  if (section === "notes" && parts.length === 1) {
    const kept: [string, string][] = [];
    const folder = search.get("folder");
    if (folder && (folder === "none" || ID.test(folder))) kept.push(["folder", folder]);
    if (search.get("tab") === "files") kept.push(["tab", "files"]);
    return kept;
  }
  if (section === "tasks" && parts.length === 1) {
    const kept: [string, string][] = [];
    const view = search.get("view") === "mine" ? "week" : search.get("view");
    if (view && TASK_VIEWS[view]) kept.push(["view", view]);
    const scope = search.get("view") === "mine" ? "mine" : search.get("scope");
    if (scope && TASK_SCOPES[scope]) kept.push(["scope", scope]);
    return kept;
  }
  return [];
}

/**
 * The page at `address` (a path, optionally with a query) inside org
 * `orgSlug`, or null for anything outside /app/{orgSlug}/ (or a path shape
 * the app does not have).
 */
export function describePath(orgSlug: string, address: string): PageInfo | null {
  const base = `/app/${orgSlug}`;
  const [pathPart, queryPart = ""] = address.split("#")[0].split("?");
  const path = pathPart.replace(/\/+$/, "");
  if (path !== base && !path.startsWith(`${base}/`)) return null;
  const parts = path.slice(base.length).split("/").filter(Boolean);
  if (parts.some((p) => !/^[A-Za-z0-9_.-]{1,80}$/.test(p))) return null;
  const pathHref = parts.length ? `${base}/${parts.join("/")}` : base;
  if (parts.length === 0) return { href: pathHref, kind: "page", label: "Overview", skipRecent: true };

  const [section, second, third] = parts;
  const kept = keptQuery(section, parts, new URLSearchParams(queryPart));
  const href = kept.length ? `${pathHref}?${new URLSearchParams(kept).toString()}` : pathHref;
  if (href.length > 400) return null;
  const q = Object.fromEntries(kept);

  const joined = parts.join("/");
  if (SUBPAGES[joined]) return { href, kind: "page", label: SUBPAGES[joined] };
  if (!SECTIONS[section]) return null;

  if (section === "notes" && parts.length === 1) {
    const files = q.tab === "files";
    if (q.folder && q.folder !== "none") {
      return {
        href,
        kind: "folder",
        label: "Folder",
        lookup: { type: "folder", id: q.folder },
        suffix: files ? " · Files" : undefined,
      };
    }
    if (q.folder === "none") return { href, kind: "page", label: files ? "Files not in a folder" : "Notes not in a folder" };
    return { href, kind: "page", label: files ? "Notes · Files" : "Notes" };
  }
  if (section === "tasks" && parts.length === 1) {
    const bits = [q.view ? TASK_VIEWS[q.view] : null, q.scope ? TASK_SCOPES[q.scope] : null].filter(Boolean);
    return { href, kind: "page", label: bits.length ? `Tasks · ${bits.join(" · ")}` : "Tasks" };
  }
  if (parts.length === 1) return { href, kind: "page", label: SECTIONS[section] };

  if (section === "settings") {
    return { href, kind: "page", label: `Settings · ${titleCase(second)}` };
  }
  if (section === "notes" && second === "files" && third && parts.length === 3 && ID.test(third)) {
    return { href, kind: "file", label: "File", lookup: { type: "file", id: third } };
  }
  if (section === "notes" && parts.length === 2 && ID.test(second)) {
    return { href, kind: "note", label: "Note", lookup: { type: "note", id: second } };
  }
  if (section === "tasks" && parts.length === 2 && ID.test(second)) {
    return { href, kind: "task", label: "Task", lookup: { type: "task", id: second } };
  }
  if (section === "calendar" && second === "polls" && third && parts.length === 3 && ID.test(third)) {
    return { href, kind: "event", label: "Poll", lookup: { type: "poll", id: third } };
  }
  if (section === "calendar" && parts.length === 2 && ID.test(second)) {
    return { href, kind: "event", label: "Event", lookup: { type: "event", id: second } };
  }
  if (section === "databases" && ID.test(second)) {
    const suffix = third ? ` · ${titleCase(third)}` : "";
    return {
      href,
      kind: "database",
      label: `${titleCase(second)}${suffix}`,
      lookup: { type: "database", key: second },
      suffix: suffix || undefined,
    };
  }
  if (section === "people" && parts.length === 2 && ID.test(second)) {
    return { href, kind: "person", label: "Person", lookup: { type: "person", id: second } };
  }
  if (section === "org-chart" && (second === "drafts" || second === "versions") && third) {
    return { href, kind: "page", label: second === "drafts" ? "Org chart draft" : "Org chart version" };
  }
  return { href, kind: "page", label: `${SECTIONS[section]} · ${titleCase(parts[parts.length - 1])}` };
}

/** The canonical address of `address`, for comparing with saved pins. */
export function canonicalHref(orgSlug: string, address: string): string | null {
  return describePath(orgSlug, address)?.href ?? null;
}
