/**
 * What an in-app path is, for pins and "Recently visited": a label for the
 * fixed pages, or the record whose name the server looks up (a note's
 * title, a database's name...). Pure: src/server/pins resolves the lookups
 * under RLS, so a label never leaks something the viewer cannot open.
 */

export const PIN_KINDS = ["page", "note", "task", "event", "database", "person", "file"] as const;
export type PinKind = (typeof PIN_KINDS)[number];

export type PageLookup =
  | { type: "note"; id: string }
  | { type: "task"; id: string }
  | { type: "event"; id: string }
  | { type: "poll"; id: string }
  | { type: "database"; key: string }
  | { type: "person"; id: string };

export interface PageInfo {
  /** The in-app path, without query or hash. */
  href: string;
  kind: PinKind;
  /** The label for fixed pages; the fallback while a lookup resolves. */
  label: string;
  lookup?: PageLookup;
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

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function titleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The page at `pathname` inside org `orgSlug`, or null for anything outside
 * /app/{orgSlug}/ (or a path shape the app does not have).
 */
export function describePath(orgSlug: string, pathname: string): PageInfo | null {
  const base = `/app/${orgSlug}`;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  if (path !== base && !path.startsWith(`${base}/`)) return null;
  const parts = path.slice(base.length).split("/").filter(Boolean);
  const href = parts.length ? `${base}/${parts.join("/")}` : base;
  if (href.length > 400 || parts.some((p) => !/^[A-Za-z0-9_.-]{1,80}$/.test(p))) return null;
  if (parts.length === 0) return { href, kind: "page", label: "Overview", skipRecent: true };

  const [section, second, third] = parts;
  const joined = parts.join("/");
  if (SUBPAGES[joined]) return { href, kind: "page", label: SUBPAGES[joined] };
  if (!SECTIONS[section]) return null;
  if (parts.length === 1) return { href, kind: "page", label: SECTIONS[section] };

  if (section === "settings") {
    return { href, kind: "page", label: `Settings · ${titleCase(second)}` };
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
      lookup: third ? undefined : { type: "database", key: second },
    };
  }
  if (section === "people" && parts.length === 2 && ID.test(second)) {
    return { href, kind: "person", label: "Person", lookup: { type: "person", id: second } };
  }
  return { href, kind: "page", label: `${SECTIONS[section]} · ${titleCase(parts[parts.length - 1])}` };
}
