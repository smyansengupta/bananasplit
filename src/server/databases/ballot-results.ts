import type { TxClient } from "@/server/db/context";

import {
  definitionLabels,
  optionsOf,
  readDefinition,
  type QuestionType,
} from "./ballot-definitions";
import type { Tier } from "./types";

/**
 * Aggregate ballot results (the per-question pivot every member sees):
 * question x option counts, plus first-choice counts and a Borda score for
 * ranked questions, from app.ballot_tally with the viewer's tier passed as
 * an explicit argument. For tiers without row access the function
 * suppresses every cell below OrgSettings.ballotMinCellSize (shown '<k'),
 * returns nothing to members while ballotResultsVisibleToMembers is off, and
 * never tallies free text. No ballot row is read here.
 */

export interface PollOption {
  id: string;
  slug: string;
  title: string;
  isTest: boolean;
  opensAt: Date | null;
  closesAt: Date | null;
  linkedEventId: string | null;
}

export interface ResultCell {
  key: string;
  label: string;
  votes: number | null;
  firstChoice: number | null;
  borda: number | null;
  suppressed: boolean;
  /** Share of the question's ballots, 0..1 (null when suppressed). */
  share: number | null;
}

export interface QuestionResult {
  key: string;
  label: string;
  type: QuestionType | null;
  ballots: number;
  options: ResultCell[];
}

export interface PollResults {
  poll: PollOption;
  /** Ballots that answered at least one question (the turnout). */
  turnout: number;
  questions: QuestionResult[];
  minCellSize: number;
  /** Results are hidden from members by Settings > Privacy. */
  hidden: boolean;
}

export async function listPolls(db: TxClient, organizationId: string): Promise<PollOption[]> {
  return db.ballotDefinition.findMany({
    where: { organizationId },
    orderBy: [{ opensAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      isTest: true,
      opensAt: true,
      closesAt: true,
      linkedEventId: true,
    },
  });
}

interface TallyRow {
  question_key: string;
  choice_key: string;
  votes: number | null;
  first_choice: number | null;
  borda: number | null;
  ballots: number;
  suppressed: boolean;
}

export async function loadPollResults(
  db: TxClient,
  organizationId: string,
  poll: PollOption,
  tier: Tier,
): Promise<PollResults> {
  const [settings, def, tally] = [
    await db.orgSettings.findUnique({
      where: { organizationId },
      select: { ballotMinCellSize: true, ballotResultsVisibleToMembers: true },
    }),
    await db.ballotDefinition.findFirst({
      where: { id: poll.id, organizationId },
      select: { definition: true },
    }),
    await db.$queryRaw<TallyRow[]>`
      SELECT question_key, choice_key, votes, first_choice, borda, ballots, suppressed
        FROM app.ballot_tally(${organizationId}, ${poll.id}, ${tier})`,
  ];
  const definition = readDefinition(def?.definition);
  const labels = definitionLabels(definition);
  const byQuestion = new Map<string, TallyRow[]>();
  for (const row of tally) {
    const list = byQuestion.get(row.question_key) ?? [];
    list.push(row);
    byQuestion.set(row.question_key, list);
  }

  const order = definition.questions.map((q) => q.key);
  for (const key of byQuestion.keys()) if (!order.includes(key)) order.push(key);

  const questions: QuestionResult[] = [];
  for (const key of order) {
    const q = definition.questions.find((x) => x.key === key);
    if (q?.type === "text") continue;
    const rows = byQuestion.get(key) ?? [];
    const ballots = rows[0] ? Number(rows[0].ballots) : 0;
    const seen = new Set<string>();
    const cells: ResultCell[] = rows.map((r) => {
      seen.add(r.choice_key);
      const votes = r.votes === null ? null : Number(r.votes);
      return {
        key: r.choice_key,
        label: labels.choice(key, r.choice_key),
        votes,
        firstChoice: r.first_choice === null ? null : Number(r.first_choice),
        borda: r.borda === null ? null : Number(r.borda),
        suppressed: r.suppressed,
        share: votes !== null && ballots > 0 ? votes / ballots : null,
      };
    });
    // Options nobody picked still get a row (0 votes is not a small cell to hide).
    if (q) {
      for (const o of optionsOf(q)) {
        if (!seen.has(o.key)) {
          cells.push({
            key: o.key,
            label: o.label,
            votes: 0,
            firstChoice: q.type === "slots" ? 0 : null,
            borda: q.type === "slots" ? 0 : null,
            suppressed: false,
            share: 0,
          });
        }
      }
    }
    if (q?.type === "slots") cells.sort((a, b) => (b.borda ?? -1) - (a.borda ?? -1));
    questions.push({
      key,
      label: labels.question(key),
      type: q?.type ?? null,
      ballots,
      options: cells,
    });
  }

  const hidden = tier === "MEMBER" && settings?.ballotResultsVisibleToMembers === false;
  return {
    poll,
    turnout: questions.reduce((m, q) => Math.max(m, q.ballots), 0),
    questions,
    minCellSize: settings?.ballotMinCellSize ?? 3,
    hidden,
  };
}
