import { generateKeyBetween } from "fractional-indexing";

import { descendantIds } from "./tree";
import type { MatchState } from "./types";
import type { ValidationNode } from "./validate";

/**
 * The draft editor's state and its pure operations: reparent and reorder
 * (drag and drop, or the "Reports to" and move buttons), add, remove,
 * match confirmation. Every operation returns a new array; ranks are
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
  isOpen: boolean;
  isAdvisor: boolean;
  responsibilities: string[];
  decidesAlone: string[];
  sourceQuote: string[];
  rank: string;
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
  return positions.map((p) => (p.id === dragId ? { ...p, reportsTo: parent, rank } : p));
}

/** Sets a new manager (the "Reports to" picker), appending at the end of its reports. */
export function setManager(positions: readonly DraftPosition[], id: string, managerId: string | null): DraftPosition[] | null {
  if (managerId === null) {
    const last = siblingsOf(positions, null, id).at(-1);
    const rank = safeKeyBetween(last?.rank ?? null, null);
    return positions.map((p) => (p.id === id ? { ...p, reportsTo: null, rank } : p));
  }
  if (managerId === id || descendantIds(toTree(positions), id).has(managerId)) return null;
  const last = siblingsOf(positions, managerId, id).at(-1);
  const rank = safeKeyBetween(last?.rank ?? null, null);
  return positions.map((p) => (p.id === id ? { ...p, reportsTo: managerId, rank } : p));
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

/** Removes a position; its reports move up to its manager. */
export function removePosition(positions: readonly DraftPosition[], id: string): DraftPosition[] {
  const self = positions.find((p) => p.id === id);
  if (!self) return [...positions];
  return positions
    .filter((p) => p.id !== id)
    .map((p) => (p.reportsTo === id ? { ...p, reportsTo: self.reportsTo } : p));
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
    isAdvisor: p.isAdvisor,
    isOpen: p.isOpen,
    userId: p.userId,
    personName: p.personName,
    matchState: p.matchState,
  }));
}
