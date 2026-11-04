import type { BallotVisibility, Role } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { buildVotes, type VoteFact, type Votes } from "@/lib/overview/votes-text";
import { pollHref } from "@/lib/polls/paths";
import type { TxClient } from "@/server/db/context";
import { loadPollResults } from "@/server/databases/ballot-results";
import { tierOf } from "@/server/databases/types";
import { pollVoteCounts } from "@/server/polls/question-polls";

import type { HomeShared } from "./home-data";
import type { PollStat } from "./queries";

/**
 * Votes (Overview): open elections (BallotDefinition between opensAt and
 * closesAt, never a test one), open member polls and quick polls, as the
 * member sees them. An election's turnout comes from app.ballot_tally at
 * the viewer's tier, so it's missing where Privacy hides results from
 * members; whether the viewer voted is only known where they may see
 * individual ballots (Settings > Privacy).
 *
 * What's open comes from the page's shared reads (./home-data.ts) and its
 * poll stats; the reads here are the results: the tallies, whose ballots
 * are the viewer's (one count for all of them), and member polls' options.
 */

const LIMIT = 4;

export interface VotesInput {
  orgId: string;
  orgSlug: string;
  userId: string;
  role: Role;
  timeZone: string;
  now: Date;
  shared: HomeShared;
  /** Turnout and the viewer's vote on each open member poll (the page's poll stats). */
  stats: ReadonlyMap<string, PollStat>;
  /** Settings > Privacy: who may read individual ballots (OrgSettings, on the page's context). */
  ballotVisibility: BallotVisibility | null | undefined;
}

export interface VotesData extends Votes {
  /** Every open vote, not just the cards shown. */
  total: number;
}

export async function loadVotes(db: TxClient, input: VotesInput): Promise<VotesData> {
  const { facts, total } = await loadVoteFacts(db, input);
  return { ...buildVotes(facts, input.now, input.timeZone), total };
}

/** Whether `role` may read individual ballots (mirrors app.can_view_ballot_rows). */
export function seesBallots(role: Role, visibility: string | null | undefined): boolean {
  switch (visibility ?? "OWNER_ONLY") {
    case "OWNER_ONLY":
      return role === "OWNER";
    case "OWNER_AND_ADMINS":
      return role === "OWNER" || role === "ADMIN";
    default:
      return false;
  }
}

/** Member polls Votes lists: newest first, the ones still standing on their own. */
export function votePolls(shared: Pick<HomeShared, "questions">) {
  return shared.questions.filter((q) => q.formId === null);
}

export async function loadVoteFacts(
  db: TxClient,
  input: VotesInput,
): Promise<{ facts: VoteFact[]; total: number }> {
  const { orgId: organizationId, userId, shared } = input;
  const base = `/app/${input.orgSlug}`;
  const facts: VoteFact[] = [];

  // Elections.
  const tier = tierOf(input.role);
  const elections = tier ? shared.elections.slice(0, LIMIT) : [];
  const canSeeBallots = seesBallots(input.role, input.ballotVisibility);
  const mine = new Set(
    canSeeBallots && elections.length
      ? (
          await db.ballot.groupBy({
            by: ["ballotDefinitionId"],
            where: {
              organizationId,
              ballotDefinitionId: { in: elections.map((e) => e.id) },
              excludedReason: null,
              voter: { userId },
            },
            _count: { _all: true },
          })
        ).map((r) => r.ballotDefinitionId)
      : [],
  );
  for (const e of elections) {
    const results = await loadPollResults(db, organizationId, e, tier!);
    facts.push({
      key: `election:${e.id}`,
      kind: "election",
      title: e.title,
      href: e.databaseKey
        ? `${base}/databases/${e.databaseKey}?f=${encodeURIComponent(`poll:eq:${e.slug}`)}`
        : `${base}/forms`,
      closesAt: e.closesAt,
      voters: results.hidden ? null : results.turnout,
      eligible: null,
      mine: canSeeBallots ? mine.has(e.id) : null,
      options: null,
    });
  }

  // Member polls: counts for everyone; who's ahead unless results wait for the close.
  const memberPolls = votePolls(shared);
  const polls = memberPolls.slice(0, LIMIT);
  const shown = polls.filter((p) => !p.hideResultsUntilClosed).map((p) => p.id);
  const counts = await pollVoteCounts(db, shown);
  const options = shown.length
    ? await db.pollOption.findMany({
        where: { organizationId, pollId: { in: shown } },
        select: { id: true, pollId: true, label: true },
      })
    : [];
  for (const p of polls) {
    const s = input.stats.get(p.id);
    facts.push({
      key: `poll:${p.id}`,
      kind: "poll",
      title: p.question,
      href: pollHref(base, "question", p.id),
      closesAt: p.closesAt,
      voters: s?.voters ?? 0,
      eligible: s?.eligible ?? shared.memberCount,
      mine: s?.mine ?? false,
      options: p.hideResultsUntilClosed
        ? null
        : options
            .filter((o) => o.pollId === p.id)
            .map((o) => ({
              label: o.label,
              votes: counts.find((c) => c.optionId === o.id)?.votes ?? 0,
            })),
    });
  }

  // Quick polls made in Forms. Their responses are owners' and admins' to
  // read (RLS), so a member sees no count and no "you answered".
  const admin = can({ role: input.role }, "settings.view");
  const quick = shared.forms.filter((f) => f.kind === "QUICK_POLL");
  for (const form of quick.slice(0, LIMIT)) {
    facts.push({
      key: `form:${form.id}`,
      kind: "poll",
      title: form.title,
      href: `${base}/forms/${form.id}`,
      closesAt: form.closesAt,
      voters: admin ? form.responses : null,
      eligible: admin ? form.members : null,
      mine: admin && !form.anonymous ? shared.answered.has(form.id) : null,
      options: null,
    });
  }
  return {
    facts,
    total: (tier ? shared.elections.length : 0) + memberPolls.length + quick.length,
  };
}
