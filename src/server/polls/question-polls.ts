import { z } from "zod";

import type { Role } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import {
  cleanText,
  closesAtProblem,
  DESCRIPTION_MAX,
  isPollOpen,
  MAX_OPTIONS,
  MIN_OPTIONS,
  optionKey,
  optionLabelProblem,
  optionsProblem,
  QUESTION_MAX,
  type QuestionPollSource,
} from "@/lib/polls/question-poll";
import type { TxClient } from "@/server/db/context";
import { userPublicSelect } from "@/server/members";

/**
 * Question polls ("ask anything") on the member path: every function runs
 * in the caller's transaction as app_user, so RLS has the last word (see
 * prisma/migrations/20261005120000_question_polls). The checks here give
 * the friendly refusals:
 *
 * - any member asks a poll and votes while it is open;
 * - its creator, or an owner/admin (events.write), closes, reopens, deletes
 *   it and removes options;
 * - options are added by the creator and admins, and by any member when the
 *   poll allows it;
 * - a vote is replaced as a whole (delete + insert), so changing or clearing
 *   it is the same call.
 *
 * Who voted for what on an anonymous poll is never read: the counts come from
 * app.poll_vote_counts, and the only vote rows loaded are the viewer's own.
 */

/** The member acting: an OrgContext from withOrgAction or withOrgTx. */
export interface PollActor {
  db: TxClient;
  organizationId: string;
  userId: string;
  role: Role | null;
}

export interface QuestionPollResult {
  error?: string;
  pollId?: string;
  optionId?: string;
}

const id = z.string().min(1).max(64);

const createSchema = z.object({
  question: z.string().max(4 * QUESTION_MAX),
  description: z
    .string()
    .max(4 * DESCRIPTION_MAX)
    .nullish(),
  options: z.array(z.string().max(1000)).max(4 * MAX_OPTIONS),
  multiple: z.boolean().optional(),
  anonymous: z.boolean().optional(),
  allowMemberOptions: z.boolean().optional(),
  hideResultsUntilClosed: z.boolean().optional(),
  /** An ISO instant, or null for no end. */
  closesAt: z.string().max(64).nullish(),
});

export type CreateQuestionPollInput = z.input<typeof createSchema>;

function canManage(actor: PollActor, poll: { createdById: string }): boolean {
  return poll.createdById === actor.userId || can(actor, "events.write");
}

const GONE = "This poll no longer exists.";
const CLOSED = "This poll is closed.";

export async function createQuestionPoll(
  actor: PollActor,
  input: unknown,
  now = new Date(),
): Promise<QuestionPollResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the poll and try again." };
  const data = parsed.data;

  const question = cleanText(data.question);
  if (!question) return { error: "Ask a question." };
  if (question.length > QUESTION_MAX)
    return { error: `Keep the question to ${QUESTION_MAX} characters.` };
  const description = data.description?.trim() || null;
  if (description && description.length > DESCRIPTION_MAX) {
    return { error: `Keep the description to ${DESCRIPTION_MAX} characters.` };
  }
  const optionsError = optionsProblem(data.options);
  if (optionsError) return { error: optionsError };
  const labels = data.options.map(cleanText).filter(Boolean);
  const closesAt = data.closesAt ? new Date(data.closesAt) : null;
  const closesError = closesAtProblem(closesAt, now);
  if (closesError) return { error: closesError };

  const poll = await actor.db.poll.create({
    data: {
      organizationId: actor.organizationId,
      question,
      description,
      multiple: data.multiple ?? false,
      anonymous: data.anonymous ?? false,
      allowMemberOptions: data.allowMemberOptions ?? false,
      hideResultsUntilClosed: data.hideResultsUntilClosed ?? false,
      closesAt,
      createdById: actor.userId,
    },
    select: { id: true },
  });
  await actor.db.pollOption.createMany({
    data: labels.map((label, sortOrder) => ({
      organizationId: actor.organizationId,
      pollId: poll.id,
      label,
      sortOrder,
      addedById: actor.userId,
    })),
  });
  return { pollId: poll.id };
}

const pollState = {
  id: true,
  createdById: true,
  multiple: true,
  allowMemberOptions: true,
  closedAt: true,
  closesAt: true,
} as const;

function findPoll(actor: PollActor, pollId: string) {
  return actor.db.poll.findFirst({
    where: { id: pollId, organizationId: actor.organizationId },
    select: pollState,
  });
}

/**
 * Sets the member's choice on a poll to exactly `optionIds`: one option on a
 * single-choice poll, any number on a multiple-choice one, none to clear it.
 */
export async function setMyVotes(
  actor: PollActor,
  pollId: unknown,
  optionIds: unknown,
  now = new Date(),
): Promise<QuestionPollResult> {
  const parsed = z
    .object({ pollId: id, optionIds: z.array(id).max(MAX_OPTIONS) })
    .safeParse({ pollId, optionIds });
  if (!parsed.success) return { error: "Pick from the poll's options." };
  const choice = [...new Set(parsed.data.optionIds)];

  const poll = await findPoll(actor, parsed.data.pollId);
  if (!poll) return { error: GONE };
  if (!isPollOpen(poll, now)) return { error: `${CLOSED} Votes can't change any more.` };
  if (!poll.multiple && choice.length > 1) return { error: "Pick one option." };
  if (choice.length > 0) {
    const found = await actor.db.pollOption.count({
      where: { organizationId: actor.organizationId, pollId: poll.id, id: { in: choice } },
    });
    if (found !== choice.length) return { error: "That option is no longer on this poll." };
  }

  const mine = { organizationId: actor.organizationId, pollId: poll.id, userId: actor.userId };
  await actor.db.pollVote.deleteMany({
    where: { ...mine, ...(choice.length > 0 ? { optionId: { notIn: choice } } : {}) },
  });
  if (choice.length > 0) {
    await actor.db.pollVote.createMany({
      data: choice.map((optionId) => ({ ...mine, optionId })),
      skipDuplicates: true,
    });
  }
  return {};
}

export async function addPollOption(
  actor: PollActor,
  pollId: unknown,
  label: unknown,
  now = new Date(),
): Promise<QuestionPollResult> {
  const parsed = z.object({ pollId: id, label: z.string().max(1000) }).safeParse({ pollId, label });
  if (!parsed.success) return { error: "Type an option first." };
  const clean = cleanText(parsed.data.label);
  const labelError = optionLabelProblem(clean);
  if (labelError) return { error: labelError };

  const poll = await findPoll(actor, parsed.data.pollId);
  if (!poll) return { error: GONE };
  if (!isPollOpen(poll, now)) return { error: `${CLOSED} Its options can't change.` };
  if (!canManage(actor, poll) && !poll.allowMemberOptions) {
    return { error: "Only whoever asked, or an admin, can add options to this poll." };
  }
  const options = await actor.db.pollOption.findMany({
    where: { organizationId: actor.organizationId, pollId: poll.id },
    select: { label: true, sortOrder: true },
  });
  if (options.length >= MAX_OPTIONS)
    return { error: `A poll can have up to ${MAX_OPTIONS} options.` };
  if (options.some((o) => optionKey(o.label) === optionKey(clean))) {
    return { error: "That option is already on the poll." };
  }
  const option = await actor.db.pollOption.create({
    data: {
      organizationId: actor.organizationId,
      pollId: poll.id,
      label: clean,
      sortOrder: Math.max(-1, ...options.map((o) => o.sortOrder)) + 1,
      addedById: actor.userId,
    },
    select: { id: true },
  });
  return { optionId: option.id };
}

/** Removes an option and the votes for it (the creator or an admin, while open). */
export async function removePollOption(
  actor: PollActor,
  pollId: unknown,
  optionId: unknown,
  now = new Date(),
): Promise<QuestionPollResult> {
  const parsed = z.object({ pollId: id, optionId: id }).safeParse({ pollId, optionId });
  if (!parsed.success) return { error: "That option is no longer on this poll." };
  const poll = await findPoll(actor, parsed.data.pollId);
  if (!poll) return { error: GONE };
  if (!canManage(actor, poll))
    return { error: "Only whoever asked, or an admin, can remove options." };
  if (!isPollOpen(poll, now)) return { error: `${CLOSED} Its options can't change.` };
  const count = await actor.db.pollOption.count({
    where: { organizationId: actor.organizationId, pollId: poll.id },
  });
  if (count <= MIN_OPTIONS) return { error: "A poll needs at least two options." };
  const removed = await actor.db.pollOption.deleteMany({
    where: { id: parsed.data.optionId, pollId: poll.id, organizationId: actor.organizationId },
  });
  return removed.count > 0 ? {} : { error: "That option is no longer on this poll." };
}

/**
 * Closes the poll now, or reopens it. Reopening a poll whose closing time
 * has passed drops that time, or it would still be closed.
 */
export async function setPollClosed(
  actor: PollActor,
  pollId: unknown,
  closed: unknown,
  now = new Date(),
): Promise<QuestionPollResult> {
  const parsed = id.safeParse(pollId);
  if (!parsed.success) return { error: GONE };
  if (typeof closed !== "boolean") return { error: "Choose whether to close or reopen the poll." };
  const poll = await findPoll(actor, parsed.data);
  if (!poll) return { error: GONE };
  if (!canManage(actor, poll)) {
    return {
      error: `Only whoever asked, or an admin, can ${closed ? "close" : "reopen"} this poll.`,
    };
  }
  // Already as asked: nothing to do.
  if (isPollOpen(poll, now) !== closed) return {};
  const data = closed
    ? { closedAt: now }
    : {
        closedAt: null,
        ...(poll.closesAt && poll.closesAt.getTime() <= now.getTime() ? { closesAt: null } : {}),
      };
  const updated = await actor.db.poll.updateMany({
    where: { id: poll.id, organizationId: actor.organizationId },
    data,
  });
  return updated.count > 0 ? {} : { error: GONE };
}

export async function deleteQuestionPoll(
  actor: PollActor,
  pollId: unknown,
): Promise<QuestionPollResult> {
  const parsed = id.safeParse(pollId);
  if (!parsed.success) return { error: GONE };
  const poll = await findPoll(actor, parsed.data);
  if (!poll) return { error: GONE };
  if (!canManage(actor, poll))
    return { error: "Only whoever asked, or an admin, can delete this poll." };
  const deleted = await actor.db.poll.deleteMany({
    where: { id: poll.id, organizationId: actor.organizationId },
  });
  return deleted.count > 0 ? {} : { error: GONE };
}

// --------------------------------------------------------------------------
// Reads
// --------------------------------------------------------------------------

export interface PollCountRow {
  pollId: string;
  optionId: string;
  votes: number;
  /** The poll's distinct voters (the same on each of its rows). */
  voters: number;
}

/**
 * Every poll's counts from app.poll_vote_counts: all votes, anonymous or
 * not, as numbers only. Polls outside the member's org are left out.
 */
export async function pollVoteCounts(
  db: TxClient,
  pollIds: readonly string[],
): Promise<PollCountRow[]> {
  if (pollIds.length === 0) return [];
  const rows = await db.$queryRaw<
    { pollId: string; optionId: string; votes: bigint; voters: bigint }[]
  >`
    SELECT "pollId", "optionId", "votes", "voters" FROM app.poll_vote_counts(${[...pollIds]}::text[])`;
  return rows.map((r) => ({
    pollId: r.pollId,
    optionId: r.optionId,
    votes: Number(r.votes),
    voters: Number(r.voters),
  }));
}

/**
 * The poll with what buildQuestionPollView needs, read as `viewerId`. Never
 * hand it to a client component: it holds user ids. Build the view.
 */
export async function loadQuestionPollSource(
  db: TxClient,
  organizationId: string,
  pollId: string,
  viewerId: string,
): Promise<QuestionPollSource | null> {
  // One query at a time: a transaction has one connection.
  const poll = await db.poll.findFirst({
    where: { id: pollId, organizationId },
    select: {
      id: true,
      question: true,
      description: true,
      multiple: true,
      anonymous: true,
      allowMemberOptions: true,
      hideResultsUntilClosed: true,
      closesAt: true,
      closedAt: true,
      createdAt: true,
      createdById: true,
    },
  });
  if (!poll) return null;
  const createdBy = await db.user.findUnique({
    where: { id: poll.createdById },
    select: { name: true },
  });
  const options = await db.pollOption.findMany({
    where: { organizationId, pollId: poll.id },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: { id: true, label: true },
  });
  const counts = await pollVoteCounts(db, [poll.id]);
  // An anonymous poll: only the viewer's own rows (RLS would hide the rest anyway).
  const votes = await db.pollVote.findMany({
    where: { organizationId, pollId: poll.id, ...(poll.anonymous ? { userId: viewerId } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { optionId: true, userId: true },
  });
  const voterIds = [...new Set(votes.map((v) => v.userId))];
  const people =
    !poll.anonymous && voterIds.length > 0
      ? await db.user.findMany({ where: { id: { in: voterIds } }, select: userPublicSelect })
      : [];
  return {
    ...poll,
    createdBy,
    options,
    counts: counts.map((c) => ({ optionId: c.optionId, votes: c.votes })),
    voterCount: counts[0]?.voters ?? 0,
    votes,
    people,
  };
}

export interface QuestionPollSummary {
  id: string;
  question: string;
  multiple: boolean;
  anonymous: boolean;
  closesAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  createdById: string;
  optionCount: number;
  voterCount: number;
}

/** Every question poll in the org, newest first, with its option and voter counts. */
export async function listQuestionPolls(
  db: TxClient,
  organizationId: string,
): Promise<QuestionPollSummary[]> {
  const polls = await db.poll.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      question: true,
      multiple: true,
      anonymous: true,
      closesAt: true,
      closedAt: true,
      createdAt: true,
      createdById: true,
    },
  });
  const counts = await pollVoteCounts(
    db,
    polls.map((p) => p.id),
  );
  const optionCount = new Map<string, number>();
  const voterCount = new Map<string, number>();
  for (const row of counts) {
    optionCount.set(row.pollId, (optionCount.get(row.pollId) ?? 0) + 1);
    voterCount.set(row.pollId, row.voters);
  }
  return polls.map((p) => ({
    ...p,
    optionCount: optionCount.get(p.id) ?? 0,
    voterCount: voterCount.get(p.id) ?? 0,
  }));
}
