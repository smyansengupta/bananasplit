/**
 * Shared org-chart types for the server, the canvas, the list view, the side
 * panel and the draft editor. Pure and client-safe (no Prisma imports).
 */

export type MatchState = "UNMATCHED" | "SUGGESTED" | "CONFIRMED";

export interface OpenItem {
  who: string;
  question: string;
}

export type WarningCode =
  | "no-positions"
  | "truncated"
  | "empty-title"
  | "duplicate-id"
  | "dangling"
  | "self-reference"
  | "manages-filled"
  | "manages-mismatch"
  | "cycle"
  | "multiple-roots"
  | "advisor-no-manager"
  | "advisor-has-reports"
  | "open-with-person";

/** A parse or normalization finding, shown in the draft checklist. */
export interface ChartWarning {
  code: WarningCode;
  message: string;
  positionKey?: string | null;
}

/** The public shape of a person on the chart (userPublicSelect; never an email). */
export interface ChartPersonDTO {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
}

/** One position of a published or read-only chart, as the client sees it. */
export interface ChartNodeDTO {
  id: string;
  key: string;
  title: string;
  personName: string | null;
  userId: string | null;
  user: ChartPersonDTO | null;
  reportsToId: string | null;
  isOpen: boolean;
  isAdvisor: boolean;
  responsibilities: string[];
  decidesAlone: string[];
  rank: string;
}

/** How a node renders: a linked member, a placeholder (named but not on the portal) or an open hire. */
export type NodeVariant = "member" | "placeholder" | "open" | "empty";

export function nodeVariant(node: Pick<ChartNodeDTO, "isOpen" | "user" | "personName">): NodeVariant {
  if (node.isOpen) return "open";
  if (node.user) return "member";
  if (node.personName) return "placeholder";
  return "empty";
}

/** The label for the person in a position. */
export function personLabel(node: Pick<ChartNodeDTO, "isOpen" | "user" | "personName">): string {
  if (node.isOpen) return "Open hire";
  return node.user?.name ?? node.personName ?? "Unfilled";
}

/** Compares fractional-indexing ranks (plain code-unit order, never localeCompare). */
export function compareRank(a: { rank: string; id: string }, b: { rank: string; id: string }): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
