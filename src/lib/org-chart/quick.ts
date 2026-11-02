import type { DraftPosition } from "./draft";
import { normalizeName } from "./match";
import { outlineOrder, planFromMembers, type TitledMember } from "./outline";

/**
 * The quick setup screens' pure logic: the questions the "Draft my chart"
 * review asks, and the seat screen's suggestions, order and member search.
 * Client-safe.
 */

// ------------------------------------------------------------------ review

export type ReviewQuestion =
  /** The draft names someone who matched a member, but not for certain. */
  | { kind: "match"; positionId: string; userId: string }
  /** The manager was picked only because the two titles share a word. */
  | { kind: "placement"; positionId: string; managerId: string };

/**
 * What the review asks about, from signals the drafting already has:
 * unconfirmed member matches (matchState SUGGESTED) and placements
 * planFromMembers marks as guessed, while the draft still has them. Nothing
 * is asked that the drafting did not flag.
 */
export function reviewQuestions(
  positions: readonly DraftPosition[],
  members: readonly TitledMember[],
): ReviewQuestion[] {
  const out: ReviewQuestion[] = [];
  for (const { position: p } of outlineOrder(positions)) {
    if (!p.userId && !p.isOpen && p.matchState === "SUGGESTED" && p.suggestedUserIds[0]) {
      out.push({ kind: "match", positionId: p.id, userId: p.suggestedUserIds[0] });
    }
  }
  const byUser = new Map<string, DraftPosition>();
  for (const p of positions) if (p.userId && !byUser.has(p.userId)) byUser.set(p.userId, p);
  for (const placed of planFromMembers(members)) {
    if (!placed.guessed || !placed.managerId) continue;
    const p = byUser.get(placed.member.id);
    const manager = byUser.get(placed.managerId);
    if (p && manager && p.reportsTo === manager.id) {
      out.push({ kind: "placement", positionId: p.id, managerId: manager.id });
    }
  }
  return out;
}

// ------------------------------------------------------------------ seats

export interface SeatMember {
  id: string;
  name: string | null;
  title: string | null;
}

const ABBREVIATIONS: [RegExp, string][] = [
  [/\bvp\b/g, "vice president"],
  [/\bsvp\b/g, "senior vice president"],
  [/\bpres\b/g, "president"],
  [/\bsec\b/g, "secretary"],
];

/** "VP, Events & Outreach" -> "vice president events and outreach". */
export function normalizeTitle(title: string | null | undefined): string {
  let t = (title ?? "").toLowerCase().replace(/&/g, " and ");
  t = normalizeName(t);
  for (const [re, full] of ABBREVIATIONS) t = t.replace(re, full);
  return t.replace(/\s+/g, " ").trim();
}

/** "vice president growth" starts with the words "vice president" ("president" does not). */
function startsWithWords(title: string, seat: string): boolean {
  return seat.length > 0 && `${title} `.startsWith(`${seat} `);
}

/** Whether a seat holds someone (a member or a typed name). */
export function isFilled(p: Pick<DraftPosition, "userId" | "personName">): boolean {
  return Boolean(p.userId || p.personName);
}

/** The seats in reading order: each manager before its reports, siblings by rank. */
export function seatOrder(positions: readonly DraftPosition[]): DraftPosition[] {
  return outlineOrder(positions).map((o) => o.position);
}

/** The next empty seat after `afterId` in reading order (wrapping), or null. */
export function nextEmptySeat(
  positions: readonly DraftPosition[],
  afterId: string | null,
): DraftPosition | null {
  const order = seatOrder(positions);
  const start = afterId ? order.findIndex((p) => p.id === afterId) + 1 : 0;
  for (let i = 0; i < order.length; i++) {
    const p = order[(start + i) % order.length];
    if (p.id !== afterId && !isFilled(p)) return p;
  }
  return null;
}

/**
 * Who to suggest for each empty seat: a member whose own title is the
 * seat's title, or starts with it ("VP Growth" for "Vice President", but
 * not for "President"). Exact titles win, then the ones that start with it, in reading
 * order; nobody is suggested twice, nor anyone already seated or in
 * `skip` (suggestions the admin turned down).
 */
export function seatSuggestions(
  positions: readonly DraftPosition[],
  members: readonly SeatMember[],
  skip: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const seated = new Set(positions.map((p) => p.userId).filter(Boolean) as string[]);
  const free = members.filter((m) => !seated.has(m.id) && normalizeTitle(m.title));
  const empty = seatOrder(positions).filter((p) => !isFilled(p) && normalizeTitle(p.title));
  const out = new Map<string, string>();
  const used = new Set<string>();
  const pass = (fits: (seat: string, member: string) => boolean) => {
    for (const p of empty) {
      if (out.has(p.id)) continue;
      const seat = normalizeTitle(p.title);
      const m = free.find(
        (m) =>
          !used.has(m.id) && !skip.has(`${p.id}:${m.id}`) && fits(seat, normalizeTitle(m.title)),
      );
      if (m) {
        out.set(p.id, m.id);
        used.add(m.id);
      }
    }
  };
  pass((seat, member) => seat === member);
  pass((seat, member) => startsWithWords(member, seat));
  return out;
}

/** Members whose name starts with (or has a word starting with) `query`; unseated first. */
export function searchMembers<M extends SeatMember>(
  query: string,
  members: readonly M[],
  seated: ReadonlySet<string>,
  limit = 6,
): M[] {
  const q = normalizeName(query);
  if (!q) return [];
  const scored: { m: M; score: number }[] = [];
  for (const m of members) {
    const name = normalizeName(m.name ?? "");
    if (!name) continue;
    let score = -1;
    if (name.startsWith(q)) score = 3;
    else if (name.split(" ").some((w) => w.startsWith(q))) score = 2;
    else if (name.includes(q)) score = 1;
    if (score < 0) continue;
    scored.push({ m, score: score + (seated.has(m.id) ? 0 : 10) });
  }
  return scored
    .sort((a, b) => b.score - a.score || (a.m.name ?? "").localeCompare(b.m.name ?? ""))
    .slice(0, limit)
    .map((s) => s.m);
}
