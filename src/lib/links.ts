import type { ChipKind } from "@/lib/overview/types";

/**
 * What can be linked in a space (ItemLink), shared by the server and the
 * Linked panel. See src/server/links/links.ts for how links are read.
 */

export const LINK_KINDS = [
  "task",
  "event",
  "note",
  "file",
  "person",
  "database",
  "transaction",
  "form",
  "budget",
  "record",
  // A question poll (Forms), a decision (Home's Decisions: it has no page
  // of its own) and an announcement (the Inbox).
  "poll",
  "decision",
  "announcement",
  // The CRM's people, companies and deals (docs/features/crm.md):
  // a task, note or meeting linked to one lands on its timeline.
  "crm-person",
  "crm-company",
  "crm-deal",
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export function isLinkKind(value: unknown): value is LinkKind {
  return typeof value === "string" && (LINK_KINDS as readonly string[]).includes(value);
}

export interface LinkRef {
  kind: LinkKind;
  id: string;
}

export interface ResolvedRef extends LinkRef {
  title: string;
  href: string;
  /** A second line: what it is, and a fact or two. */
  detail: string;
  /** How Home draws it as a chip: a meeting or an event, a quick poll, money. */
  chip: ChipKind;
  /** Events: when it starts, and how many members said they're going. */
  startsAt?: Date;
  going?: number;
  /** Tasks: finished. */
  done?: boolean;
}

export interface LinkedItem extends ResolvedRef {
  /** The ItemLink row, for Remove. */
  linkId: string;
}

export const KIND_WORD: Record<LinkKind, string> = {
  task: "Task",
  event: "Meeting",
  note: "Note",
  file: "File",
  person: "Person",
  database: "Database",
  transaction: "Finance",
  form: "Form",
  budget: "Budget",
  record: "Row",
  poll: "Poll",
  decision: "Decision",
  announcement: "Announcement",
  "crm-person": "Contact",
  "crm-company": "Company",
  "crm-deal": "Deal",
};

/**
 * Whether an event is a meeting: a board meeting, or one with a meeting
 * type. The one rule for links and Home's chips: a meeting opens on its
 * meeting page, anything else on the calendar.
 */
export function isMeeting(event: { kind: string; meetingType: string | null }): boolean {
  return event.kind === "BOARD_MEETING" || Boolean(event.meetingType);
}

/** The search palette's kinds that can be linked, and what they link as. */
export function linkKindOfSearch(kind: string): LinkKind | null {
  if (kind === "epic") return "task";
  // Search's polls include Find a time, which can't be linked: those ids
  // would never resolve as question polls.
  if (kind === "poll") return null;
  return isLinkKind(kind) ? kind : null;
}

/** The thing a search hit ("task:abc") is, when it can be linked. */
export function linkRefOfHit(hit: { kind: string; key: string }): LinkRef | null {
  const kind = linkKindOfSearch(hit.kind);
  if (!kind) return null;
  const at = hit.key.indexOf(":");
  const id = at === -1 ? "" : hit.key.slice(at + 1);
  return id ? { kind, id } : null;
}

const ID = "([A-Za-z0-9_-]{1,64})";
const PAGE_KINDS: [RegExp, LinkKind][] = [
  [new RegExp(`^/app/[^/]+/tasks/${ID}$`), "task"],
  [new RegExp(`^/app/[^/]+/meetings/${ID}$`), "event"],
  [new RegExp(`^/app/[^/]+/notes/files/${ID}$`), "file"],
  [new RegExp(`^/app/[^/]+/notes/${ID}$`), "note"],
  [new RegExp(`^/app/[^/]+/people/${ID}$`), "person"],
  [new RegExp(`^/app/[^/]+/forms/${ID}$`), "form"],
  [new RegExp(`^/app/[^/]+/databases/${ID}$`), "database"],
];
/** Paths under a kind that are pages of their own, not one thing. */
const NOT_AN_ID = new Set(["new", "polls", "files", "import", "reports"]);

/**
 * The thing a page is about, when it is one linkable thing (a task's page,
 * a meeting's, a note's), so whatever is made from there can be linked to
 * it. Null on lists and everything else.
 */
export function refFromPath(pathname: string): LinkRef | null {
  for (const [pattern, kind] of PAGE_KINDS) {
    const m = pattern.exec(pathname);
    if (m && !NOT_AN_ID.has(m[1]!)) return { kind, id: m[1]! };
  }
  return null;
}

/**
 * What the side peek shows for one linked thing: its title, what it is, a
 * few facts as label and value, and a passage of its text, read as the
 * viewer (row-level security), so a peek never shows more than the page
 * would. Null when they can't see it.
 */
export interface PeekSummary {
  kind: LinkKind;
  id: string;
  title: string;
  /** "Task, due Fri": the same second line the Linked panel shows. */
  detail: string;
  href: string;
  facts: { label: string; value: string }[];
  /** Up to a few hundred characters of its own words. */
  text: string | null;
}
