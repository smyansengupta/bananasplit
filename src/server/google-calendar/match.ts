import type { ImportedEvent } from "./mapping";

/**
 * Matching Google events to existing suite events for the one-time import,
 * so an event that is already in the suite (created in the Calendar, or
 * synced from the website's sessions) gets its googleEventId linked instead
 * of becoming a second Event.
 *
 * Pure: the import job loads both sides and applies the plan.
 *
 *   exact      a suite event already carries this googleEventId (on this
 *              calendar), or the Google event is the suite's own mirror
 *              (extendedProperties.private.suiteEventId) -> no-op / relink
 *   matched    one clear title-and-time candidate -> link it
 *   ambiguous  several close candidates -> create it flagged needsReview
 *              (the 'Possible duplicates' queue)
 *   new        no candidate -> create a PUBLIC event
 *
 * A suite event is matched at most once; suite events already linked to a
 * different Google event are not candidates.
 */

export interface SuiteCandidate {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  googleCalendarId: string | null;
  googleEventId: string | null;
  deletedAt: Date | null;
  mergedIntoId: string | null;
}

export type ImportDecision =
  | { action: "unchanged"; google: ImportedEvent; suiteEventId: string }
  | { action: "relink"; google: ImportedEvent; suiteEventId: string }
  | { action: "link"; google: ImportedEvent; suiteEventId: string; score: number }
  | { action: "ambiguous"; google: ImportedEvent; candidateIds: string[] }
  | { action: "create"; google: ImportedEvent }
  | { action: "skip"; google: ImportedEvent; reason: string };

const STOP = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "to",
  "for",
  "with",
  "on",
  "at",
  "in",
  "cbc",
  "claude",
  "builders",
  "club",
]);

export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 0 && !STOP.has(t));
}

/** 0..1: token overlap (Jaccard), 1 for identical normalized titles. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.join(" ") === tb.join(" ")) return ta.length > 0 || a.trim() === b.trim() ? 1 : 0;
  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** 0..1 closeness of two start times (a 12h window covers timezone slips). */
export function timeCloseness(a: Date, b: Date): number {
  const d = Math.abs(a.getTime() - b.getTime());
  if (d <= 15 * MIN) return 1;
  if (d <= 2 * HOUR) return 0.7;
  if (d <= 12 * HOUR) return 0.4;
  return 0;
}

export function matchScore(google: ImportedEvent, suite: SuiteCandidate): number {
  const time = timeCloseness(google.startsAt, suite.startsAt);
  if (time === 0) return 0;
  const title = titleSimilarity(google.title, suite.title);
  if (title < 0.34 && time < 1) return 0;
  return Math.round((0.6 * title + 0.4 * time) * 1000) / 1000;
}

/** Candidates at or above this score are considered the same event. */
export const MATCH_THRESHOLD = 0.6;
/** The best candidate wins outright when it leads the next by this much. */
export const CLEAR_LEAD = 0.25;

export function planImport(
  googleEvents: readonly ImportedEvent[],
  suiteEvents: readonly SuiteCandidate[],
  ctx: { organizationId: string; calendarId: string },
): ImportDecision[] {
  const live = suiteEvents.filter((s) => !s.deletedAt && !s.mergedIntoId);
  const byGoogleId = new Map(
    suiteEvents
      .filter((s) => s.googleEventId && s.googleCalendarId === ctx.calendarId)
      .map((s) => [s.googleEventId as string, s]),
  );
  const byId = new Map(suiteEvents.map((s) => [s.id, s]));
  const claimed = new Set<string>();
  const decisions: ImportDecision[] = [];

  const sorted = [...googleEvents].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() || (a.googleEventId < b.googleEventId ? -1 : 1),
  );

  // Pass 1: exact links, so pass 2 never offers an already-linked event.
  const rest: ImportedEvent[] = [];
  for (const g of sorted) {
    const linked = byGoogleId.get(g.googleEventId);
    if (linked) {
      claimed.add(linked.id);
      decisions.push({ action: "unchanged", google: g, suiteEventId: linked.id });
      continue;
    }
    if (g.mirrorOf) {
      const own =
        g.mirrorOf.orgId === ctx.organizationId ? byId.get(g.mirrorOf.suiteEventId) : undefined;
      if (own && !own.deletedAt && !own.mergedIntoId && !own.googleEventId) {
        claimed.add(own.id);
        decisions.push({ action: "relink", google: g, suiteEventId: own.id });
      } else {
        // Another org's or a deleted event's mirror: never import it.
        decisions.push({ action: "skip", google: g, reason: "a suite mirror" });
      }
      continue;
    }
    rest.push(g);
  }

  // Pass 2: title-and-time matching.
  for (const g of rest) {
    const scored = live
      .filter((s) => !claimed.has(s.id) && !s.googleEventId)
      .map((s) => ({ id: s.id, score: matchScore(g, s) }))
      .filter((c) => c.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    if (scored.length === 0) {
      decisions.push({ action: "create", google: g });
      continue;
    }
    const [best, second] = scored;
    if (!second || best.score - second.score >= CLEAR_LEAD) {
      claimed.add(best.id);
      decisions.push({ action: "link", google: g, suiteEventId: best.id, score: best.score });
      continue;
    }
    decisions.push({ action: "ambiguous", google: g, candidateIds: scored.map((c) => c.id) });
  }
  return decisions;
}

export interface ImportSummary {
  total: number;
  unchanged: number;
  linked: number;
  created: number;
  ambiguous: number;
  skipped: number;
}

export function summarize(decisions: readonly ImportDecision[]): ImportSummary {
  const s: ImportSummary = {
    total: decisions.length,
    unchanged: 0,
    linked: 0,
    created: 0,
    ambiguous: 0,
    skipped: 0,
  };
  for (const d of decisions) {
    if (d.action === "unchanged") s.unchanged += 1;
    else if (d.action === "link" || d.action === "relink") s.linked += 1;
    else if (d.action === "create") s.created += 1;
    else if (d.action === "ambiguous") s.ambiguous += 1;
    else s.skipped += 1;
  }
  return s;
}
