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
};

/** The search palette's kinds that can be linked, and what they link as. */
export function linkKindOfSearch(kind: string): LinkKind | null {
  if (kind === "epic") return "task";
  if (kind === "poll") return "form";
  return isLinkKind(kind) ? kind : null;
}
