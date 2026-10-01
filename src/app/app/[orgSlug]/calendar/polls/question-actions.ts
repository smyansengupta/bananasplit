"use server";

import { refresh } from "next/cache";

import { NotFoundError } from "@/lib/auth/errors";
import { withOrgAction } from "@/server/db/context";
import * as polls from "@/server/polls/question-polls";
import type { QuestionPollResult } from "@/server/polls/question-polls";

import { actionError } from "../action-result";

/**
 * Question polls on the member path: each action is one withOrgAction
 * transaction (app_user, RLS) over src/server/polls/question-polls.ts.
 * Refusals come back as { error }. Votes, options and closing refresh the
 * page they were made on, so it re-renders with the server's counts (the
 * page shows the change before that, optimistically). Creating and deleting
 * navigate instead.
 */

function failed(error: unknown): { error: string } {
  // Not a member (any more), or the org is gone: say so about the poll.
  if (error instanceof NotFoundError) return { error: "This poll no longer exists." };
  return actionError(error);
}

async function run(
  fn: () => Promise<QuestionPollResult>,
  options: { refresh: boolean },
): Promise<QuestionPollResult> {
  try {
    const result = await fn();
    if (options.refresh) refresh();
    return result;
  } catch (error) {
    return failed(error);
  }
}

const createTx = withOrgAction((ctx, input: unknown) => polls.createQuestionPoll(ctx, input));
const voteTx = withOrgAction((ctx, pollId: string, optionIds: string[]) =>
  polls.setMyVotes(ctx, pollId, optionIds),
);
const addOptionTx = withOrgAction((ctx, pollId: string, label: string) =>
  polls.addPollOption(ctx, pollId, label),
);
const removeOptionTx = withOrgAction((ctx, pollId: string, optionId: string) =>
  polls.removePollOption(ctx, pollId, optionId),
);
const setClosedTx = withOrgAction((ctx, pollId: string, closed: boolean) =>
  polls.setPollClosed(ctx, pollId, closed),
);
const deleteTx = withOrgAction((ctx, pollId: string) => polls.deleteQuestionPoll(ctx, pollId));

/** Any member asks a question; returns the new poll's id. */
export async function createQuestionPoll(orgId: string, input: polls.CreateQuestionPollInput) {
  return run(() => createTx(orgId, input), { refresh: false });
}

/** Sets the member's choice to exactly these options ([] clears it). */
export async function voteOnQuestionPoll(orgId: string, pollId: string, optionIds: string[]) {
  return run(() => voteTx(orgId, pollId, optionIds), { refresh: true });
}

export async function addQuestionPollOption(orgId: string, pollId: string, label: string) {
  return run(() => addOptionTx(orgId, pollId, label), { refresh: true });
}

export async function removeQuestionPollOption(orgId: string, pollId: string, optionId: string) {
  return run(() => removeOptionTx(orgId, pollId, optionId), { refresh: true });
}

/** Closes the poll now (closed: true), or reopens it. */
export async function setQuestionPollClosed(orgId: string, pollId: string, closed: boolean) {
  return run(() => setClosedTx(orgId, pollId, closed), { refresh: true });
}

export async function deleteQuestionPoll(orgId: string, pollId: string) {
  return run(() => deleteTx(orgId, pollId), { refresh: false });
}
