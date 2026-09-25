import { Prisma } from "@/generated/prisma/client";

import { inRange, isoText, localDateText, lowerBound, num, numOrNull, pct } from "../sql";
import type {
  BallotOptionResult,
  BallotQuestionResult,
  BallotResult,
  BallotsReport,
} from "../types";
import type { ReportQuery } from "./common";

/** At most this many ballots per range (newest first). */
export const MAX_BALLOTS = 12;

/**
 * 6. Ballots: results per BallotDefinition with turnout, through
 * app.ballot_tally(p_org, p_definition_id, p_tier) with the viewer tier
 * passed explicitly (this runs on the service path, where there is no user
 * GUC). ballot_tally owns the privacy rules:
 * - tiers without row access (app.can_view_ballot_rows) get every cell
 *   below OrgSettings.ballotMinCellSize suppressed (NULL, shown as '<k');
 * - a MEMBER gets nothing while ballotResultsVisibleToMembers is false;
 * - excluded ballots (test, out of window) and free text are never tallied.
 * An option nobody chose is absent from the tally; for a suppressed tier it
 * is shown as '<k' too (0 is below k), so absence reveals nothing.
 *
 * Which ballots: non-test definitions whose window overlaps the range, or
 * that have a valid ballot cast in it. Results are always the ballot's full
 * tally (a vote is not split by date). Turnout = valid ballots / check-ins
 * at the linked session, or n/a without one.
 */
export const queryBallots: ReportQuery<BallotsReport> = async (db, args) => {
  const settings = await db.$queryRaw<
    { k: number | null; members_see: boolean | null; full: boolean }[]
  >`
    SELECT st."ballotMinCellSize" AS k,
           st."ballotResultsVisibleToMembers" AS members_see,
           app.can_view_ballot_rows(${args.orgId}, ${args.tier}) AS full
      FROM (SELECT 1) one
      LEFT JOIN public."OrgSettings" st ON st."organizationId" = ${args.orgId}`;
  const minCellSize = num(settings[0]?.k ?? 3);
  const fullCounts = settings[0]?.full === true;
  const membersSee = settings[0]?.members_see ?? true;
  if (args.tier === "MEMBER" && !membersSee) {
    return { hidden: true, minCellSize, fullCounts: false, ballots: [] };
  }

  const cast = Prisma.sql`b."castAt"`;
  const defs = await db.$queryRaw<
    {
      id: string;
      slug: string;
      title: string;
      opens_at: string | null;
      closes_at: string | null;
      opens_on: string | null;
      definition: unknown;
      ballots: number;
      event_id: string | null;
      event_title: string | null;
      event_date: string | null;
      event_checkins: number | null;
    }[]
  >`
    SELECT d."id" AS id, d."slug" AS slug, d."title" AS title,
           ${isoText(Prisma.sql`d."opensAt"`)} AS opens_at,
           ${isoText(Prisma.sql`d."closesAt"`)} AS closes_at,
           ${localDateText(Prisma.sql`d."opensAt"`, args.tz)} AS opens_on,
           d."definition" AS definition,
           (SELECT count(*)::int FROM public."Ballot" b
             WHERE b."organizationId" = ${args.orgId} AND b."ballotDefinitionId" = d."id"
               AND b."excludedReason" IS NULL) AS ballots,
           e."id" AS event_id,
           e."title" AS event_title,
           ${localDateText(Prisma.sql`e."startsAt"`, args.tz)} AS event_date,
           e."attendanceCount" AS event_checkins
      FROM public."BallotDefinition" d
      LEFT JOIN public."Event" e
        ON e."organizationId" = d."organizationId" AND e."id" = d."linkedEventId"
       AND e."deletedAt" IS NULL AND e."mergedIntoId" IS NULL
     WHERE d."organizationId" = ${args.orgId}
       AND NOT d."isTest"
       AND (
         (d."opensAt" IS NOT NULL
           AND ${inRange(Prisma.sql`d."opensAt"`, null, args.to, args.tz)}
           AND coalesce(d."closesAt", 'infinity'::timestamp) >= ${lowerBound(args.from, args.tz)})
         OR EXISTS (
           SELECT 1 FROM public."Ballot" b
            WHERE b."organizationId" = ${args.orgId} AND b."ballotDefinitionId" = d."id"
              AND b."excludedReason" IS NULL
              AND ${inRange(cast, args.from, args.to, args.tz)})
       )
     ORDER BY coalesce(d."opensAt", d."createdAt") DESC, d."id"
     LIMIT ${MAX_BALLOTS}`;

  if (defs.length === 0) return { hidden: false, minCellSize, fullCounts, ballots: [] };

  const tally = await db.$queryRaw<
    {
      definition_id: string;
      question_key: string;
      choice_key: string;
      votes: number | null;
      first_choice: number | null;
      borda: number | null;
      ballots: number;
      suppressed: boolean;
    }[]
  >`
    SELECT d.id AS definition_id, t.question_key, t.choice_key, t.votes, t.first_choice, t.borda, t.ballots, t.suppressed
      FROM unnest(ARRAY[${Prisma.join(defs.map((d) => d.id))}]::text[]) AS d(id)
     CROSS JOIN LATERAL app.ballot_tally(${args.orgId}, d.id, ${args.tier}) AS t`;

  const ballots: BallotResult[] = defs.map((d) => {
    const cells = tally.filter((t) => t.definition_id === d.id);
    const parsed = parseDefinition(d.definition);
    const questions = buildQuestions(parsed, cells, fullCounts);
    const count = num(d.ballots);
    const checkIns = numOrNull(d.event_checkins);
    return {
      id: d.id,
      slug: d.slug,
      title: d.title,
      opensAt: d.opens_at,
      closesAt: d.closes_at,
      opensOn: d.opens_on,
      ballots: count,
      linkedSession:
        d.event_id && d.event_title && d.event_date
          ? {
              id: d.event_id,
              title: d.event_title,
              localDate: d.event_date,
              checkIns: checkIns ?? 0,
            }
          : null,
      turnoutPct: checkIns ? pct(count, checkIns) : null,
      questions,
      freeTextQuestions: parsed.filter((q) => q.type === "text").length,
    };
  });
  return { hidden: false, minCellSize, fullCounts, ballots };
};

/** The key of the folded row of rare answers outside the definition. */
export const OTHER_ANSWERS = "__other";

interface ParsedQuestion {
  key: string;
  label: string;
  type: string;
  options: { key: string; label: string }[];
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The questions of a BallotDefinition.definition, leniently ({questions: [{key, label, type, options}]}). */
export function parseDefinition(definition: unknown): ParsedQuestion[] {
  const raw = (definition as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(raw)) return [];
  const out: ParsedQuestion[] = [];
  for (const q of raw) {
    const key = str((q as { key?: unknown })?.key);
    if (!key) continue;
    const type = str((q as { type?: unknown }).type) ?? "single";
    const options: { key: string; label: string }[] = [];
    const rawOptions = (q as { options?: unknown }).options;
    if (Array.isArray(rawOptions)) {
      for (const o of rawOptions) {
        const optKey = typeof o === "string" ? o : str((o as { key?: unknown })?.key);
        if (!optKey) continue;
        options.push({ key: optKey, label: str((o as { label?: unknown })?.label) ?? optKey });
      }
    }
    if (type === "yesno" && options.length === 0) {
      options.push({ key: "yes", label: "Yes" }, { key: "no", label: "No" });
    }
    out.push({ key, label: str((q as { label?: unknown }).label) ?? key, type, options });
  }
  return out;
}

interface TallyCell {
  question_key: string;
  choice_key: string;
  votes: number | null;
  first_choice: number | null;
  borda: number | null;
  ballots: number;
  suppressed: boolean;
}

/**
 * Joins the tally onto the definition's questions and options (labels,
 * definition order), keeps options that appear only in the tally (answers
 * outside the definition), and sorts options by votes (ranked questions by
 * Borda score). Suppressed options sort last in definition order.
 */
export function buildQuestions(
  parsed: ParsedQuestion[],
  cells: TallyCell[],
  fullCounts: boolean,
): BallotQuestionResult[] {
  const byQuestion = new Map<string, TallyCell[]>();
  for (const c of cells) {
    const list = byQuestion.get(c.question_key) ?? [];
    list.push(c);
    byQuestion.set(c.question_key, list);
  }
  const questions: ParsedQuestion[] = parsed.filter((q) => q.type !== "text");
  for (const key of byQuestion.keys()) {
    if (!parsed.some((q) => q.key === key))
      questions.push({ key, label: key, type: "single", options: [] });
  }

  return questions.map((q) => {
    const qCells = byQuestion.get(q.key) ?? [];
    const ranked =
      q.type === "slots" || qCells.some((c) => c.first_choice !== null || c.borda !== null);
    const known = new Map(q.options.map((o, i) => [o.key, { ...o, order: i }]));
    let foldedOther = false;
    for (const c of qCells) {
      if (known.has(c.choice_key)) continue;
      if (c.suppressed && !fullCounts) {
        // An answer outside the definition that fewer than k people gave:
        // its text alone could identify them, so it folds into one row.
        foldedOther = true;
        continue;
      }
      known.set(c.choice_key, { key: c.choice_key, label: c.choice_key, order: known.size });
    }
    const options: (BallotOptionResult & { order: number })[] = [...known.values()].map((o) => {
      const cell = qCells.find((c) => c.choice_key === o.key);
      if (cell) {
        return {
          key: o.key,
          label: o.label,
          votes: numOrNull(cell.votes),
          firstChoice: ranked ? numOrNull(cell.first_choice) : null,
          borda: ranked ? numOrNull(cell.borda) : null,
          suppressed: cell.suppressed === true,
          order: o.order,
        };
      }
      // Nobody chose it: 0 votes, which a suppressed tier sees as '<k'.
      return fullCounts
        ? {
            key: o.key,
            label: o.label,
            votes: 0,
            firstChoice: ranked ? 0 : null,
            borda: ranked ? 0 : null,
            suppressed: false,
            order: o.order,
          }
        : {
            key: o.key,
            label: o.label,
            votes: null,
            firstChoice: null,
            borda: null,
            suppressed: true,
            order: o.order,
          };
    });
    if (foldedOther) {
      options.push({
        key: OTHER_ANSWERS,
        label: "Other answers",
        votes: null,
        firstChoice: null,
        borda: null,
        suppressed: true,
        order: Number.MAX_SAFE_INTEGER,
      });
    }
    options.sort((a, b) => {
      if (a.suppressed !== b.suppressed) return a.suppressed ? 1 : -1;
      const av = ranked ? (a.borda ?? 0) : (a.votes ?? 0);
      const bv = ranked ? (b.borda ?? 0) : (b.votes ?? 0);
      return bv - av || a.order - b.order;
    });
    return {
      key: q.key,
      label: q.label,
      type: ranked ? "slots" : q.type,
      ballots: num(qCells[0]?.ballots ?? 0),
      options: options.map(({ order: _order, ...o }) => o),
    };
  });
}
