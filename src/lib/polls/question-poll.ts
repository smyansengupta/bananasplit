import { parseAvatarVariants, type AvatarVariants } from "@/lib/avatar";

/**
 * Question polls ("ask anything"), the pure parts: what a valid poll is,
 * whether one is open, its results, and the poll as one viewer may see it.
 *
 * Client-safe (no server imports, no zod): the form checks the same rules
 * before it sends, and the poll page recomputes the results the moment a
 * vote changes, before the server answers.
 *
 * Anonymity is enforced by the database (PollVote RLS and
 * app.poll_vote_counts), and again here: buildQuestionPollView never puts
 * a voter's name, picture or id in the view of an anonymous poll, whatever
 * rows it is handed.
 */

export const QUESTION_MAX = 200;
export const DESCRIPTION_MAX = 2000;
export const OPTION_MAX = 120;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 20;
/** The furthest ahead a closing time may be. */
export const MAX_CLOSE_DAYS = 366;

/** One line, as stored: runs of whitespace collapsed, ends trimmed. */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** What makes two options "the same": case and spacing are ignored. */
export function optionKey(label: string): string {
  return cleanText(label).toLocaleLowerCase();
}

/**
 * The index of the first label that repeats an earlier one (ignoring case
 * and spacing), or -1. Blank labels are not compared.
 */
export function findDuplicateOption(labels: readonly string[]): number {
  const seen = new Set<string>();
  for (const [i, label] of labels.entries()) {
    const key = optionKey(label);
    if (!key) continue;
    if (seen.has(key)) return i;
    seen.add(key);
  }
  return -1;
}

/** Why an option label can't be used, or null. */
export function optionLabelProblem(label: string): string | null {
  const clean = cleanText(label);
  if (!clean) return "Options can't be empty.";
  if (clean.length > OPTION_MAX) return `Keep options to ${OPTION_MAX} characters.`;
  return null;
}

/** Why the options of a new poll won't do (after dropping blank rows), or null. */
export function optionsProblem(labels: readonly string[]): string | null {
  const filled = labels.map(cleanText).filter(Boolean);
  if (filled.length < MIN_OPTIONS) return "Add at least two options.";
  if (filled.length > MAX_OPTIONS) return `A poll can have up to ${MAX_OPTIONS} options.`;
  for (const label of filled) {
    const problem = optionLabelProblem(label);
    if (problem) return problem;
  }
  if (findDuplicateOption(filled) !== -1) return "Each option must be different.";
  return null;
}

/** Why a closing time won't do, or null (no closing time is fine). */
export function closesAtProblem(closesAt: Date | null, now: Date): string | null {
  if (!closesAt) return null;
  if (Number.isNaN(closesAt.getTime())) return "Enter a valid closing time.";
  if (closesAt.getTime() <= now.getTime() + 60_000) return "Pick a closing time in the future.";
  if (closesAt.getTime() > now.getTime() + MAX_CLOSE_DAYS * 86_400_000) {
    return "Pick a closing time within a year.";
  }
  return null;
}

/** Open: not closed by hand, and its closing time (if any) has not come. */
export function isPollOpen(
  poll: { closedAt: Date | null; closesAt: Date | null },
  now: Date,
): boolean {
  return (
    poll.closedAt === null && (poll.closesAt === null || poll.closesAt.getTime() > now.getTime())
  );
}

export interface TallyRow {
  id: string;
  votes: number;
  /** Of the people who voted (a multiple-choice poll can add up past 100). */
  percent: number;
  /** Has the most votes (ties all lead); nothing leads before the first vote. */
  leading: boolean;
}

/** Each option's share of the voters, and which lead. */
export function tally(
  options: readonly { id: string; votes: number }[],
  voters: number,
): TallyRow[] {
  const top = Math.max(0, ...options.map((o) => o.votes));
  return options.map((o) => ({
    id: o.id,
    votes: o.votes,
    percent: voters > 0 ? Math.round((o.votes / voters) * 100) : 0,
    leading: top > 0 && o.votes === top,
  }));
}

/**
 * The counts after the viewer's choice changes from `before` to `after`:
 * what the page shows while the vote is on its way to the server.
 */
export function applyMyVote(
  votes: Readonly<Record<string, number>>,
  voters: number,
  before: readonly string[],
  after: readonly string[],
): { votes: Record<string, number>; voters: number } {
  const next = { ...votes };
  const was = new Set(before);
  const now = new Set(after);
  for (const id of was) if (!now.has(id)) next[id] = Math.max(0, (next[id] ?? 0) - 1);
  for (const id of now) if (!was.has(id)) next[id] = (next[id] ?? 0) + 1;
  const delta = (now.size > 0 ? 1 : 0) - (was.size > 0 ? 1 : 0);
  return { votes: next, voters: Math.max(0, voters + delta) };
}

// --------------------------------------------------------------------------
// The view: what one viewer may see of a poll.
// --------------------------------------------------------------------------

/** A voter as shown on a named poll: an opaque key, never a user id. */
export interface PollVoter {
  /** "me" for the viewer, else "v1", "v2"... (stable within one render). */
  key: string;
  name: string;
  image: string | null;
  /** The avatar's picture URLs only (src/lib/avatar), for UserAvatar. */
  avatar: AvatarVariants;
}

export interface QuestionPollOptionView {
  id: string;
  label: string;
  /** null while the results are hidden from this viewer. */
  votes: number | null;
  /** Who picked it: null on an anonymous poll, and while results are hidden. */
  voters: PollVoter[] | null;
}

export interface QuestionPollView {
  id: string;
  question: string;
  description: string | null;
  multiple: boolean;
  anonymous: boolean;
  allowMemberOptions: boolean;
  hideResultsUntilClosed: boolean;
  closesAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  /** The name of whoever asked. */
  askedBy: string | null;
  isOpen: boolean;
  /** Counts are shown: once it closes, and before unless hidden from this viewer. */
  resultsVisible: boolean;
  options: QuestionPollOptionView[];
  /** How many people have voted (a number, never who). */
  voterCount: number;
  /** The viewer's own choices, by option id. */
  myVotes: string[];
  /** The viewer as a voter, to add to an option as they vote (named polls only). */
  me: PollVoter | null;
  canVote: boolean;
  canAddOption: boolean;
  /** Close, reopen, delete, remove an option: the creator, owners and admins. */
  canManage: boolean;
}

interface Person {
  id: string;
  name: string | null;
  image: string | null;
  avatar: unknown;
}

/** The stored poll, as loaded on the server. Never hand it to a client component. */
export interface QuestionPollSource {
  id: string;
  question: string;
  description: string | null;
  multiple: boolean;
  anonymous: boolean;
  allowMemberOptions: boolean;
  hideResultsUntilClosed: boolean;
  closesAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  createdById: string;
  createdBy: { name: string | null } | null;
  /** In display order. */
  options: { id: string; label: string }[];
  /** From app.poll_vote_counts: every vote counted, whoever cast it. */
  counts: { optionId: string; votes: number }[];
  voterCount: number;
  /**
   * The vote rows the viewer can read, oldest first: everyone's on a named
   * poll, only their own on an anonymous one (RLS).
   */
  votes: { optionId: string; userId: string }[];
  /** Public profiles of the people in `votes`. */
  people: Person[];
}

export interface QuestionPollViewer {
  userId: string;
  /** The org's events.write (owners and admins). */
  isAdmin: boolean;
  profile: { name: string | null; image: string | null; avatar: unknown };
}

function voterOf(key: string, person: Omit<Person, "id"> | undefined): PollVoter {
  return {
    key,
    name: person?.name?.trim() || "Member",
    image: person?.image ?? null,
    avatar: parseAvatarVariants(person?.avatar),
  };
}

export function buildQuestionPollView(
  poll: QuestionPollSource,
  viewer: QuestionPollViewer,
  now: Date,
): QuestionPollView {
  const isOpen = isPollOpen(poll, now);
  const canManage = poll.createdById === viewer.userId || viewer.isAdmin;
  const resultsVisible = !isOpen || !poll.hideResultsUntilClosed || canManage;
  const showVoters = resultsVisible && !poll.anonymous;

  const counts = new Map(poll.counts.map((c) => [c.optionId, c.votes]));
  const people = new Map(poll.people.map((p) => [p.id, p]));
  const keys = new Map<string, string>();
  const keyOf = (userId: string) => {
    if (userId === viewer.userId) return "me";
    let key = keys.get(userId);
    if (!key) {
      key = `v${keys.size + 1}`;
      keys.set(userId, key);
    }
    return key;
  };
  const me = voterOf("me", viewer.profile);

  const myVotes: string[] = [];
  const votersByOption = new Map<string, PollVoter[]>();
  for (const vote of poll.votes) {
    if (vote.userId === viewer.userId) {
      if (!myVotes.includes(vote.optionId)) myVotes.push(vote.optionId);
    }
    // An anonymous poll names nobody, not even from rows that slipped through.
    if (!showVoters) continue;
    const list = votersByOption.get(vote.optionId) ?? [];
    const key = keyOf(vote.userId);
    if (!list.some((v) => v.key === key)) {
      list.push(key === "me" ? me : voterOf(key, people.get(vote.userId)));
    }
    votersByOption.set(vote.optionId, list);
  }

  return {
    id: poll.id,
    question: poll.question,
    description: poll.description,
    multiple: poll.multiple,
    anonymous: poll.anonymous,
    allowMemberOptions: poll.allowMemberOptions,
    hideResultsUntilClosed: poll.hideResultsUntilClosed,
    closesAt: poll.closesAt,
    closedAt: poll.closedAt,
    createdAt: poll.createdAt,
    askedBy: poll.createdBy?.name?.trim() || null,
    isOpen,
    resultsVisible,
    options: poll.options.map((o) => ({
      id: o.id,
      label: o.label,
      votes: resultsVisible ? (counts.get(o.id) ?? 0) : null,
      voters: showVoters ? (votersByOption.get(o.id) ?? []) : null,
    })),
    voterCount: poll.voterCount,
    myVotes,
    me: poll.anonymous ? null : me,
    canVote: isOpen,
    canAddOption:
      isOpen && poll.options.length < MAX_OPTIONS && (canManage || poll.allowMemberOptions),
    canManage,
  };
}
