import { daysBetweenKeys, localDateKey } from "@/lib/tasks/dates";
import { dayWordOfKey } from "@/lib/overview/format";

/**
 * Votes: open elections and polls with their turnout, whether the viewer
 * has voted, and who's ahead where the results are open. Nothing is
 * assumed: no organization defines a quorum, so none is shown; an
 * election's electorate isn't a known number, so its turnout is a count
 * without an "of". Pure; the loader gathers VoteFacts.
 */

export interface VoteFact {
  key: string;
  kind: "election" | "poll";
  title: string;
  href: string;
  closesAt: Date | null;
  /** Votes so far; null when the viewer can't see results. */
  voters: number | null;
  /** Who can vote, when that's a known number (members, for a member poll). */
  eligible: number | null;
  /** Null when it isn't knowable for this viewer (an election's ballots are private). */
  mine: boolean | null;
  /** Options with their votes, when results are open (a member poll). */
  options: { label: string; votes: number }[] | null;
}

export interface VoteCard {
  key: string;
  kind: VoteFact["kind"];
  title: string;
  href: string;
  /** "Closes Sun", "Closes today", or null when it stays open. */
  closes: string | null;
  voters: number | null;
  eligible: number | null;
  /** Share voted, 0 to 100, when there's an eligible number. */
  percent: number | null;
  mine: boolean | null;
  /** "Dec 5 leads, 4 to 3", "Dec 5 and Dec 6 are tied at 4". */
  leader: string | null;
}

export interface Votes {
  cards: VoteCard[];
  insight: string | null;
}

/** Who's ahead, from the options' votes; null with no votes or no results. */
export function leaderLine(
  options: readonly { label: string; votes: number }[] | null,
): string | null {
  if (!options || options.length < 2) return null;
  const sorted = [...options].sort((a, b) => b.votes - a.votes);
  const [first, second] = sorted;
  if (first.votes === 0) return null;
  if (first.votes === second.votes)
    return `${first.label} and ${second.label} are tied at ${first.votes}`;
  return `${first.label} leads, ${first.votes} to ${second.votes}`;
}

function closesWord(closesAt: Date | null, todayKey: string, timeZone: string): string | null {
  if (!closesAt) return null;
  const word = dayWordOfKey(localDateKey(closesAt, timeZone), todayKey);
  return `Closes ${word === "Today" || word === "Tomorrow" ? word.toLowerCase() : word}`;
}

export function buildVotes(facts: readonly VoteFact[], now: Date, timeZone: string): Votes {
  const todayKey = localDateKey(now, timeZone);
  const sorted = [...facts].sort(
    (a, b) => (a.closesAt?.getTime() ?? Infinity) - (b.closesAt?.getTime() ?? Infinity),
  );
  const cards = sorted.map((f): VoteCard => ({
    key: f.key,
    kind: f.kind,
    title: f.title,
    href: f.href,
    closes: closesWord(f.closesAt, todayKey, timeZone),
    voters: f.voters,
    eligible: f.eligible,
    percent:
      f.voters !== null && f.eligible
        ? Math.min(100, Math.round((f.voters / Math.max(f.eligible, f.voters)) * 100))
        : null,
    mine: f.mine,
    leader: leaderLine(f.options),
  }));
  return { cards, insight: votesInsight(sorted, todayKey, timeZone) };
}

/**
 * One line: a vote you haven't cast that closes within three days, else
 * the soonest-closing one with under half the members voted.
 */
function votesInsight(
  facts: readonly VoteFact[],
  todayKey: string,
  timeZone: string,
): string | null {
  const daysLeft = (f: VoteFact) =>
    f.closesAt ? daysBetweenKeys(todayKey, localDateKey(f.closesAt, timeZone)) : Infinity;
  const day = (f: VoteFact) => closesWord(f.closesAt, todayKey, timeZone)!.replace(/^Closes /, "");
  const unvoted = facts.filter((f) => f.mine === false && daysLeft(f) <= 3);
  if (unvoted[0]) {
    return `You haven't voted on ${unvoted[0].title} yet. It closes ${day(unvoted[0])}.`;
  }
  const low = facts.find(
    (f) => f.voters !== null && f.eligible && daysLeft(f) <= 7 && f.voters * 2 < f.eligible,
  );
  if (low) {
    return `${low.title} has ${low.voters} of ${low.eligible} votes and closes ${day(low)}.`;
  }
  return null;
}
