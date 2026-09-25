import { foldCase } from "./text";
import type { MatchState } from "./types";

/**
 * Local fuzzy matching of a position's person_name to the org's members
 * (never sent to Claude). Pure; runs on the server after a parse (with the
 * members' email local parts) and in the draft editor (names only).
 *
 * Tiers, best score per member:
 *   exact       the normalized full names are equal                 1.00
 *   token-set   the same words in any order                         0.95
 *   subset      every word of the name is in the member's name       0.90
 *   initials    "J. Lamoureux", "Jackson L."                         0.88
 *   first-name  a single word equal to exactly one member's first    0.85
 *               name (0.60 when several members share it)
 *   fuzzy       Jaro-Winkler >= 0.85 on full names with the     0.9 x JW
 *               same number of words (typos)                  (max 0.85)
 *   email       the name equals the member's email local part        0.75
 *   monogram    "JL" equals the member's initials                    0.70
 *
 * Suggestions scoring at least 0.6 are kept, best first, at most three.
 * A match is only ever SUGGESTED: an admin confirms it.
 */

export type MatchReason =
  "exact" | "token-set" | "subset" | "initials" | "first-name" | "fuzzy" | "email" | "monogram";

export interface MatchCandidate {
  userId: string;
  name: string | null;
  /** Server-side only: the part of the member's email before the @. */
  emailLocal?: string | null;
}

export interface MatchSuggestion {
  userId: string;
  score: number;
  reason: MatchReason;
}

export interface PersonMatch {
  state: Exclude<MatchState, "CONFIRMED">;
  /** The best suggestion's score, or null. */
  score: number | null;
  suggestions: MatchSuggestion[];
}

export const MIN_SUGGESTION_SCORE = 0.6;
export const MAX_SUGGESTIONS = 3;

/** NFKD, diacritics folded, lowercase, punctuation dropped, spaces collapsed. */
export function normalizeName(input: string): string {
  return foldCase(input)
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(input: string): string[] {
  return normalizeName(input).split(" ").filter(Boolean);
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(b.length - 1, i + window);
    for (let j = lo; j <= hi; j++) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** "J. Lamoureux" / "Jackson L." against "jackson lamoureux": same length, initials or words, one full word. */
function initialsMatch(person: string[], member: string[]): boolean {
  if (person.length !== member.length || person.length < 2) return false;
  let full = 0;
  for (let i = 0; i < person.length; i++) {
    const p = person[i];
    const m = member[i];
    if (p === m) full++;
    else if (!(p.length === 1 && m.startsWith(p))) return false;
  }
  return full >= 1 && full < person.length;
}

function scoreCandidate(
  person: string[],
  personNorm: string,
  candidate: MatchCandidate,
  firstNameCount: Map<string, number>,
): MatchSuggestion | null {
  const best: MatchSuggestion = { userId: candidate.userId, score: 0, reason: "fuzzy" };
  const offer = (score: number, reason: MatchReason) => {
    if (score > best.score) {
      best.score = score;
      best.reason = reason;
    }
  };

  const memberTokens = candidate.name ? tokens(candidate.name) : [];
  const memberNorm = memberTokens.join(" ");

  if (memberNorm) {
    if (memberNorm === personNorm) offer(1, "exact");
    const sortedP = [...person].sort().join(" ");
    const sortedM = [...memberTokens].sort().join(" ");
    if (person.length > 1 && sortedP === sortedM) offer(0.95, "token-set");
    if (person.length > 1 && person.every((t) => memberTokens.includes(t))) offer(0.9, "subset");
    if (initialsMatch(person, memberTokens)) offer(0.88, "initials");
    if (person.length === 1 && memberTokens[0] === person[0]) {
      offer((firstNameCount.get(person[0]) ?? 0) === 1 ? 0.85 : 0.6, "first-name");
    }
    if (person.length === 1 && person[0].length >= 2 && memberTokens.length >= 2) {
      const monogram = memberTokens.map((t) => t[0]).join("");
      if (person[0] === monogram) offer(0.7, "monogram");
    }
    if (person.length === memberTokens.length) {
      const jw = jaroWinkler(personNorm, memberNorm);
      if (jw >= 0.85) offer(Math.min(0.85, 0.9 * jw), "fuzzy");
    }
  }

  if (candidate.emailLocal) {
    const local = normalizeName(candidate.emailLocal.replace(/\d+/g, " "));
    const localJoined = local.replace(/ /g, "");
    if (local && (local === personNorm || localJoined === person.join(""))) offer(0.75, "email");
    else if (person.length >= 2 && localJoined === `${person[0][0]}${person[person.length - 1]}`) {
      offer(0.75, "email");
    }
  }

  return best.score >= MIN_SUGGESTION_SCORE
    ? { ...best, score: Math.round(best.score * 1000) / 1000 }
    : null;
}

/** Suggestions for one person name among `candidates`. */
export function matchPerson(
  personName: string | null | undefined,
  candidates: readonly MatchCandidate[],
): PersonMatch {
  const person = personName ? tokens(personName) : [];
  if (person.length === 0) return { state: "UNMATCHED", score: null, suggestions: [] };
  const personNorm = person.join(" ");

  const firstNameCount = new Map<string, number>();
  for (const c of candidates) {
    const first = c.name ? tokens(c.name)[0] : undefined;
    if (first) firstNameCount.set(first, (firstNameCount.get(first) ?? 0) + 1);
  }

  const suggestions = candidates
    .map((c) => scoreCandidate(person, personNorm, c, firstNameCount))
    .filter((s): s is MatchSuggestion => s !== null)
    .sort((a, b) => b.score - a.score || (a.userId < b.userId ? -1 : 1))
    .slice(0, MAX_SUGGESTIONS);

  return suggestions.length === 0
    ? { state: "UNMATCHED", score: null, suggestions: [] }
    : { state: "SUGGESTED", score: suggestions[0].score, suggestions };
}

/** True when the best suggestion is an exact name match ("Confirm all exact"). */
export function isExactMatch(match: Pick<PersonMatch, "suggestions">): boolean {
  return match.suggestions[0]?.reason === "exact";
}
