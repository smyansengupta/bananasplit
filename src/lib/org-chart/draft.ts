import { generateKeyBetween } from "fractional-indexing";

import { descendantIds } from "./tree";
import type { MatchState } from "./types";
import type { ValidationNode } from "./validate";

/**
 * The draft editor's state and its pure operations: reparent and reorder
 * (drag and drop, or the "Reports to" and move buttons), extra managers
 * (dotted lines), add, remove, match confirmation. Every operation returns a new array; ranks are
 * fractional-indexing keys among siblings.
 */

export interface DraftPosition {
  /** The row id, or "new-..." for a position added in this session. */
  id: string;
  /** Empty for a new position (the server assigns it on save). */
  key: string;
  title: string;
  personName: string | null;
  userId: string | null;
  matchState: MatchState;
  matchScore: number | null;
  suggestedUserIds: string[];
  reportsTo: string | null;
  /** Extra managers (dotted lines): ids of other positions in the draft. */
  alsoReportsTo?: string[];
  isOpen: boolean;
  isAdvisor: boolean;
  responsibilities: string[];
  decidesAlone: string[];
  sourceQuote: string[];
  rank: string;
  /** The team it's on (an id from the draft's teams); none: its manager's. */
  teamId?: string | null;
}

export type DropZone = "before" | "after" | "inside";

function byRank(a: DraftPosition, b: DraftPosition): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function siblingsOf(positions: readonly DraftPosition[], parent: string | null, exceptId?: string): DraftPosition[] {
  return positions.filter((p) => p.reportsTo === parent && p.id !== exceptId).sort(byRank);
}

function safeKeyBetween(a: string | null, b: string | null): string {
  try {
    return generateKeyBetween(a, b);
  } catch {
    // Ranks out of order (e.g. equal ranks from an old copy): append instead.
    return generateKeyBetween(b ?? a, null);
  }
}

/** Whether `dragId` may be dropped on `targetId` in `zone`. */
export function canDrop(positions: readonly DraftPosition[], dragId: string, targetId: string, zone: DropZone): boolean {
  if (dragId === targetId) return false;
  const target = positions.find((p) => p.id === targetId);
  if (!target) return false;
  if (descendantIds(toTree(positions), dragId).has(targetId)) return false;
  if (zone === "inside" && target.isAdvisor) return false;
  return true;
}

/** Moves `dragId` inside `targetId` (as its last report) or before/after it among its siblings. */
export function moveDraft(
  positions: readonly DraftPosition[],
  dragId: string,
  targetId: string,
  zone: DropZone,
): DraftPosition[] | null {
  if (!canDrop(positions, dragId, targetId, zone)) return null;
  const target = positions.find((p) => p.id === targetId) as DraftPosition;
  let parent: string | null;
  let rank: string;
  if (zone === "inside") {
    parent = target.id;
    const last = siblingsOf(positions, parent, dragId).at(-1);
    rank = safeKeyBetween(last?.rank ?? null, null);
  } else {
    parent = target.reportsTo;
    const siblings = siblingsOf(positions, parent, dragId);
    const i = siblings.findIndex((s) => s.id === target.id);
    const prev = zone === "before" ? (siblings[i - 1] ?? null) : target;
    const next = zone === "before" ? target : (siblings[i + 1] ?? null);
    rank = safeKeyBetween(prev?.rank ?? null, next?.rank ?? null);
  }
  return positions.map((p) => (p.id === dragId ? withManager(p, parent, rank) : p));
}

/** A new primary manager; it stops being an extra one. */
function withManager(p: DraftPosition, reportsTo: string | null, rank: string): DraftPosition {
  const also = p.alsoReportsTo?.filter((id) => id !== reportsTo);
  return { ...p, reportsTo, rank, ...(also ? { alsoReportsTo: also } : {}) };
}

/** Sets a new manager (the "Reports to" picker), appending at the end of its reports. */
export function setManager(positions: readonly DraftPosition[], id: string, managerId: string | null): DraftPosition[] | null {
  if (managerId === null) {
    const last = siblingsOf(positions, null, id).at(-1);
    const rank = safeKeyBetween(last?.rank ?? null, null);
    return positions.map((p) => (p.id === id ? withManager(p, null, rank) : p));
  }
  if (managerId === id || descendantIds(toTree(positions), id).has(managerId)) return null;
  const last = siblingsOf(positions, managerId, id).at(-1);
  const rank = safeKeyBetween(last?.rank ?? null, null);
  return positions.map((p) => (p.id === id ? withManager(p, managerId, rank) : p));
}

/**
 * Who `id` could also report to: anyone but itself, its manager, its
 * current extra managers, an advisor (nobody reports to one) and the
 * positions below it (that would be a loop).
 */
export function extraManagerOptions(positions: readonly DraftPosition[], id: string): DraftPosition[] {
  const self = positions.find((p) => p.id === id);
  if (!self) return [];
  const below = descendantIds(toTree(positions), id);
  const taken = new Set(self.alsoReportsTo ?? []);
  return positions.filter((p) => !below.has(p.id) && !p.isAdvisor && p.id !== self.reportsTo && !taken.has(p.id));
}

/** Adds an extra manager (a dotted line); null when it isn't one of extraManagerOptions. */
export function addAlsoReportsTo(positions: readonly DraftPosition[], id: string, managerId: string): DraftPosition[] | null {
  if (!extraManagerOptions(positions, id).some((p) => p.id === managerId)) return null;
  return positions.map((p) => (p.id === id ? { ...p, alsoReportsTo: [...(p.alsoReportsTo ?? []), managerId] } : p));
}

/** Removes an extra manager. */
export function removeAlsoReportsTo(positions: readonly DraftPosition[], id: string, managerId: string): DraftPosition[] {
  return positions.map((p) =>
    p.id === id && p.alsoReportsTo ? { ...p, alsoReportsTo: p.alsoReportsTo.filter((m) => m !== managerId) } : p,
  );
}

/** Moves a position one place up or down among its siblings. */
export function moveSibling(positions: readonly DraftPosition[], id: string, direction: -1 | 1): DraftPosition[] {
  const self = positions.find((p) => p.id === id);
  if (!self) return [...positions];
  const siblings = siblingsOf(positions, self.reportsTo);
  const i = siblings.findIndex((s) => s.id === id);
  const j = i + direction;
  if (j < 0 || j >= siblings.length) return [...positions];
  const target = siblings[j];
  return moveDraft(positions, id, target.id, direction < 0 ? "before" : "after") ?? [...positions];
}

let counter = 0;
export function newPositionId(): string {
  counter += 1;
  return `new-${Date.now().toString(36)}-${counter}`;
}

/** Adds an empty position under `parentId` (or at the top level). */
export function addPosition(
  positions: readonly DraftPosition[],
  parentId: string | null,
  id = newPositionId(),
): DraftPosition[] {
  const last = siblingsOf(positions, parentId).at(-1);
  return [
    ...positions,
    {
      id,
      key: "",
      title: "New position",
      personName: null,
      userId: null,
      matchState: "UNMATCHED",
      matchScore: null,
      suggestedUserIds: [],
      reportsTo: parentId,
      isOpen: false,
      isAdvisor: false,
      responsibilities: [],
      decidesAlone: [],
      sourceQuote: [],
      rank: safeKeyBetween(last?.rank ?? null, null),
    },
  ];
}

/** Removes a position; its reports move up to its manager, and its dotted lines go. */
export function removePosition(positions: readonly DraftPosition[], id: string): DraftPosition[] {
  const self = positions.find((p) => p.id === id);
  if (!self) return [...positions];
  return positions
    .filter((p) => p.id !== id)
    .map((p) => {
      const next = p.reportsTo === id ? withManager(p, self.reportsTo, p.rank) : p;
      return next.alsoReportsTo?.includes(id) ? { ...next, alsoReportsTo: next.alsoReportsTo.filter((m) => m !== id) } : next;
    });
}

/** Links a member (an admin's confirmation). */
export function confirmMember(p: DraftPosition, userId: string, memberName: string | null): DraftPosition {
  return {
    ...p,
    userId,
    matchState: "CONFIRMED",
    isOpen: false,
    personName: p.personName ?? memberName,
  };
}

/** Unlinks the member; the name stays as a placeholder. */
export function unlinkMember(p: DraftPosition): DraftPosition {
  return { ...p, userId: null, matchState: p.suggestedUserIds.length > 0 ? "SUGGESTED" : "UNMATCHED" };
}

/** Positions whose best suggestion is an exact name match and not yet confirmed. */
export function exactMatches(positions: readonly DraftPosition[]): DraftPosition[] {
  return positions.filter(
    (p) => !p.userId && !p.isOpen && p.matchState === "SUGGESTED" && p.matchScore === 1 && p.suggestedUserIds[0],
  );
}

export function confirmAllExact(
  positions: readonly DraftPosition[],
  names: ReadonlyMap<string, string | null>,
): DraftPosition[] {
  const exact = new Set(exactMatches(positions).map((p) => p.id));
  return positions.map((p) =>
    exact.has(p.id) ? confirmMember(p, p.suggestedUserIds[0], names.get(p.suggestedUserIds[0]) ?? null) : p,
  );
}

export function toTree(positions: readonly DraftPosition[]) {
  return positions.map((p) => ({ id: p.id, key: p.key || p.id, reportsToId: p.reportsTo, isAdvisor: p.isAdvisor, rank: p.rank }));
}

export function toValidationNodes(positions: readonly DraftPosition[]): ValidationNode[] {
  return positions.map((p) => ({
    id: p.id,
    key: p.key || p.id,
    title: p.title,
    reportsTo: p.reportsTo,
    alsoReportsTo: p.alsoReportsTo ?? [],
    isAdvisor: p.isAdvisor,
    isOpen: p.isOpen,
    userId: p.userId,
    personName: p.personName,
    matchState: p.matchState,
  }));
}
