import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import type { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

/**
 * Session identity across importers (Phase 4b): the website sync here, the
 * one-time Google import in Phase 7. Given an external session, find the
 * suite Event it is:
 *
 *   1. Exact link first: Event.sourceSessionId (website) or googleEventId
 *      (Google) equals the external id.
 *   2. Otherwise the candidates are live Events of the org with no link for
 *      this source, starting on the same org-local date, within 90 minutes,
 *      whose normalized titles match (token-set similarity >= 0.8, or one
 *      title contains the other).
 *   3. One candidate: link it. Several: the importer creates a new INTERNAL
 *      Event flagged needsReview for the admin's 'Possible duplicates' queue.
 *      None: the importer creates a new INTERNAL Event.
 */

export type MatchSource = "SUPABASE" | "GOOGLE";

export const MATCH_WINDOW_MINUTES = 90;
export const TITLE_SIMILARITY_THRESHOLD = 0.8;

const STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
  "cbc", "session", "sessions",
]);

/** Lower-case word tokens of a title, without punctuation and stop words. */
export function titleTokens(title: string): string[] {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  return [...new Set(words)];
}

/** Jaccard similarity of the two titles' token sets, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(titleTokens(a));
  const tb = new Set(titleTokens(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Same title, for matching: similar enough, or one contains the other. */
export function titlesMatch(a: string, b: string): { match: boolean; score: number } {
  const score = titleSimilarity(a, b);
  if (score >= TITLE_SIMILARITY_THRESHOLD) return { match: true, score };
  const na = titleTokens(a).join(" ");
  const nb = titleTokens(b).join(" ");
  if (na.length > 0 && nb.length > 0 && (na.includes(nb) || nb.includes(na))) {
    return { match: true, score: Math.max(score, TITLE_SIMILARITY_THRESHOLD) };
  }
  return { match: false, score };
}

/** The org-local calendar date (yyyy-MM-dd) of an instant. */
export function localDate(at: Date, timezone: string): string {
  return format(new TZDate(at.getTime(), timezone || "UTC"), "yyyy-MM-dd");
}

export interface ExternalSession {
  source: MatchSource;
  externalId: string;
  title: string;
  startsAt: Date;
}

export interface CandidateEvent {
  id: string;
  title: string;
  startsAt: Date;
}

export type MatchResult =
  | { kind: "exact"; eventId: string }
  | { kind: "matched"; eventId: string; score: number }
  | { kind: "ambiguous"; candidates: { eventId: string; score: number }[] }
  | { kind: "none" };

/**
 * The matching rule on already-loaded candidates (pure; the database
 * version below loads them). Candidates must already exclude Events linked
 * to this source.
 */
export function pickMatch(
  session: Pick<ExternalSession, "title" | "startsAt">,
  candidates: readonly CandidateEvent[],
  timezone: string,
): MatchResult {
  const day = localDate(session.startsAt, timezone);
  const windowMs = MATCH_WINDOW_MINUTES * 60 * 1000;
  const hits: { eventId: string; score: number }[] = [];
  for (const c of candidates) {
    if (Math.abs(c.startsAt.getTime() - session.startsAt.getTime()) > windowMs) continue;
    if (localDate(c.startsAt, timezone) !== day) continue;
    const t = titlesMatch(session.title, c.title);
    if (t.match) hits.push({ eventId: c.id, score: Math.round(t.score * 1000) / 1000 });
  }
  if (hits.length === 1) return { kind: "matched", eventId: hits[0].eventId, score: hits[0].score };
  if (hits.length > 1) return { kind: "ambiguous", candidates: hits.sort((a, b) => b.score - a.score) };
  return { kind: "none" };
}

function unlinkedFor(source: MatchSource): Prisma.EventWhereInput {
  return source === "SUPABASE" ? { sourceSessionId: null } : { googleEventId: null };
}

/**
 * Finds the Event an external session is, in the caller's transaction
 * (withSystemOrgTx for importers). See the module comment for the rule.
 */
export async function findEventMatch(
  db: TxClient,
  organizationId: string,
  session: ExternalSession,
  timezone: string,
): Promise<MatchResult> {
  const exact = await db.event.findFirst({
    where:
      session.source === "SUPABASE"
        ? { organizationId, sourceSessionId: session.externalId }
        : { organizationId, googleEventId: session.externalId },
    select: { id: true },
  });
  if (exact) return { kind: "exact", eventId: exact.id };

  const windowMs = MATCH_WINDOW_MINUTES * 60 * 1000;
  const candidates = await db.event.findMany({
    where: {
      organizationId,
      deletedAt: null,
      mergedIntoId: null,
      ...unlinkedFor(session.source),
      startsAt: {
        gte: new Date(session.startsAt.getTime() - windowMs),
        lte: new Date(session.startsAt.getTime() + windowMs),
      },
    },
    select: { id: true, title: true, startsAt: true },
    take: 50,
  });
  return pickMatch(session, candidates, timezone);
}

/**
 * Pairs of live Events that look like the same session (same local date,
 * within 90 minutes, matching titles): the admin 'Possible duplicates'
 * queue, alongside Events an importer flagged needsReview.
 */
export function findDuplicatePairs(
  events: readonly CandidateEvent[],
  timezone: string,
): { a: string; b: string; score: number }[] {
  const sorted = [...events].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
  const windowMs = MATCH_WINDOW_MINUTES * 60 * 1000;
  const pairs: { a: string; b: string; score: number }[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (b.startsAt.getTime() - a.startsAt.getTime() > windowMs) break;
      if (localDate(a.startsAt, timezone) !== localDate(b.startsAt, timezone)) continue;
      const t = titlesMatch(a.title, b.title);
      if (t.match) pairs.push({ a: a.id, b: b.id, score: Math.round(t.score * 1000) / 1000 });
    }
  }
  return pairs;
}
