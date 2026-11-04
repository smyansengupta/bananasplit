import {
  addPosition,
  confirmMember,
  newPositionId,
  removePosition,
  type DraftPosition,
} from "./draft";
import { outlineOrder } from "./outline";
import { normalizeTitle } from "./quick";

/**
 * "Ask everyone where they sit": members place themselves on a draft and
 * an admin approves. Pure and client-safe.
 *
 * A member's answer is kept on the position itself: a marker in its
 * sourceQuote (which the client can't write; saveDraft keeps a row's
 * quotes as they are), and the member as an unconfirmed suggestion until
 * someone approves it. A role that wasn't on the chart is a new position
 * with an "added" marker.
 */

const PLACED = "self-placed:";
const ADDED = "self-added:";

export interface SelfPlacement {
  userId: string;
  /** The member added this role; it wasn't on the chart. */
  added: boolean;
}

/** Whether a source quote is a self-placement marker (never shown as a quote). */
export function isPlacementMarker(quote: string): boolean {
  return quote.startsWith(PLACED) || quote.startsWith(ADDED);
}

/** The source quotes to show: everything but the markers. */
export function visibleQuotes(quotes: readonly string[]): string[] {
  return quotes.filter((q) => !isPlacementMarker(q));
}

/** Who placed themselves in `p`, if anyone. */
export function placementOf(p: Pick<DraftPosition, "sourceQuote">): SelfPlacement | null {
  for (const q of p.sourceQuote) {
    if (q.startsWith(PLACED)) return { userId: q.slice(PLACED.length), added: false };
    if (q.startsWith(ADDED)) return { userId: q.slice(ADDED.length), added: true };
  }
  return null;
}

/** Waiting for approval: the member is only suggested, not linked yet. */
export function isPending(p: DraftPosition): boolean {
  const placed = placementOf(p);
  return Boolean(placed && p.userId !== placed.userId);
}

export interface PlacementSummary {
  /** Members who answered. */
  placed: Set<string>;
  /** Answers to approve, in reading order. */
  pending: { position: DraftPosition; userId: string; added: boolean }[];
}

export function placementSummary(positions: readonly DraftPosition[]): PlacementSummary {
  const placed = new Set<string>();
  const pending: PlacementSummary["pending"] = [];
  for (const { position } of outlineOrder(positions)) {
    const mark = placementOf(position);
    if (!mark) continue;
    placed.add(mark.userId);
    if (isPending(position)) pending.push({ position, userId: mark.userId, added: mark.added });
  }
  return { placed, pending };
}

function heldBy(p: DraftPosition): string | null {
  return p.userId ?? placementOf(p)?.userId ?? null;
}

/**
 * The positions a member can pick, in reading order: their own, and the
 * ones nobody holds or has asked for.
 */
export function choosablePositions(
  positions: readonly DraftPosition[],
  userId: string,
): DraftPosition[] {
  return outlineOrder(positions)
    .map((o) => o.position)
    .filter((p) => {
      const who = heldBy(p);
      if (who) return who === userId;
      return !p.personName || p.isOpen;
    });
}

/**
 * The member's best guess, already picked for them: the position they
 * answered with or already hold, else a free one with their title.
 */
export function bestGuess(
  positions: readonly DraftPosition[],
  member: { id: string; title: string | null },
): DraftPosition | null {
  const options = choosablePositions(positions, member.id);
  const mine = options.find((p) => heldBy(p) === member.id);
  if (mine) return mine;
  const title = normalizeTitle(member.title);
  return (title && options.find((p) => normalizeTitle(p.title) === title)) || null;
}

export type PlaceChoice = { positionId: string } | { title: string; managerId: string | null };

/** Empties a position the member is leaving: an open role again. */
function vacate(p: DraftPosition): DraftPosition {
  return {
    ...p,
    personName: null,
    userId: null,
    matchState: "UNMATCHED",
    matchScore: null,
    suggestedUserIds: [],
    isOpen: true,
    sourceQuote: visibleQuotes(p.sourceQuote),
  };
}

/**
 * The draft with the member's answer: they leave anything they held or
 * asked for, and wait for approval in the one they picked (or in the new
 * role they added). Picking the position they already hold just records
 * the answer. Null when the choice isn't one they can make.
 */
export function placeSelf(
  positions: readonly DraftPosition[],
  member: { id: string; name: string | null },
  choice: PlaceChoice,
  id: string = newPositionId(),
): DraftPosition[] | null {
  const chosenId = "positionId" in choice ? choice.positionId : null;
  if (chosenId && !choosablePositions(positions, member.id).some((p) => p.id === chosenId))
    return null;
  if ("title" in choice) {
    if (!choice.title.trim()) return null;
    const manager = choice.managerId ? positions.find((p) => p.id === choice.managerId) : null;
    if (choice.managerId && (!manager || manager.isAdvisor)) return null;
  }

  let next = [...positions];
  for (const p of positions) {
    if (p.id === chosenId || heldBy(p) !== member.id) continue;
    // A role they added (not approved yet) goes with them; anything else opens up.
    const mark = placementOf(p);
    if (mark?.added && p.userId !== member.id) next = removePosition(next, p.id);
    else next = next.map((x) => (x.id === p.id ? vacate(x) : x));
  }

  const claim = (p: DraftPosition, added: boolean): DraftPosition => {
    const quotes = visibleQuotes(p.sourceQuote);
    if (p.userId === member.id) return { ...p, sourceQuote: [...quotes, `${PLACED}${member.id}`] };
    return {
      ...p,
      personName: member.name,
      userId: null,
      matchState: "SUGGESTED",
      matchScore: 1,
      suggestedUserIds: [member.id],
      isOpen: false,
      sourceQuote: [...quotes, `${added ? ADDED : PLACED}${member.id}`],
    };
  };

  if (chosenId) return next.map((p) => (p.id === chosenId ? claim(p, false) : p));
  if (!("title" in choice)) return null;
  const managerId =
    choice.managerId && next.some((p) => p.id === choice.managerId) ? choice.managerId : null;
  return addPosition(next, managerId, id).map((p) =>
    p.id === id ? claim({ ...p, title: choice.title.trim().slice(0, 120) }, true) : p,
  );
}

/** Approves an answer: the member is linked to the position. */
export function approvePlacement(
  positions: readonly DraftPosition[],
  positionId: string,
  name: string | null,
): DraftPosition[] | null {
  const p = positions.find((x) => x.id === positionId);
  const mark = p ? placementOf(p) : null;
  if (!p || !mark) return null;
  return positions.map((x) => (x.id === positionId ? confirmMember(x, mark.userId, name) : x));
}

/** Turns an answer down: the position goes back to how the chart had it (an added role goes). */
export function declinePlacement(
  positions: readonly DraftPosition[],
  positionId: string,
): DraftPosition[] | null {
  const p = positions.find((x) => x.id === positionId);
  const mark = p ? placementOf(p) : null;
  if (!p || !mark) return null;
  if (mark.added) return removePosition(positions, positionId);
  return positions.map((x) => (x.id === positionId ? vacate(x) : x));
}
