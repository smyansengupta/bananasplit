import "server-only";

import { z } from "zod";

import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { pollHref } from "@/lib/polls/paths";
import { buildQuestionPollView, MAX_OPTIONS, optionKey } from "@/lib/polls/question-poll";
import type { OrgContext } from "@/server/db/context";
import { loadQuestionPollSource, setMyVotes } from "@/server/polls/question-polls";

import { itemId, refOf } from "./ids";
import {
  ConnectorInputError,
  itemArg,
  readResult,
  spaceRef,
  urlField,
  type ConnectorSession,
  type ToolRegistrar,
} from "./shared";
import type { ToolSpace } from "./space";
import { OVERWRITES, refuseOn, writeInSpace } from "./write";

/**
 * vote_in_poll (docs/features/ai-connectors.md, Phase 3): the member's
 * vote on a question poll, as the poll page casts it (setMyVotes,
 * src/server/polls/question-polls.ts): exactly the options given, by
 * label, replacing their earlier vote; none clears it. A find-a-time poll
 * is answered on its own page. The result reads as the poll page shows it
 * to this member: counts stay hidden until it closes when the poll says so,
 * and an anonymous poll names nobody.
 */

const POLLS = { feature: "polls", section: "polls" } as const;

const voteInput = z.object({
  id: itemArg("poll"),
  choices: z
    .array(z.string().min(1).max(500))
    .max(MAX_OPTIONS)
    .describe(
      "The options to vote for, by their labels as fetch lists them: one on a single-choice poll. An empty list takes the member's vote back.",
    ),
});

const voteOutput = z.object({
  space: spaceRef,
  poll: z.object({
    id: z.string(),
    question: z.string(),
    open: z.boolean(),
    multiple: z.boolean().describe("More than one choice allowed."),
    yourVotes: z.array(z.string()).describe("The labels the member voted for."),
    options: z.array(
      z.object({
        label: z.string(),
        votes: z.number().int().nullable().describe("Null while the results are hidden."),
      }),
    ),
    voters: z.number().int().describe("How many people have voted."),
    url: urlField,
  }),
});

type VoteOutput = z.infer<typeof voteOutput>;

function viewerOf(ctx: OrgContext) {
  return {
    userId: ctx.userId,
    isAdmin: can({ role: ctx.role }, "events.write"),
    profile: { name: ctx.user.name ?? null, image: null, avatar: null },
  };
}

async function pollOutput(
  ctx: OrgContext,
  space: ToolSpace,
  pollId: string,
  now: Date,
): Promise<VoteOutput> {
  const source = await loadQuestionPollSource(ctx.db, space.id, pollId, ctx.userId);
  if (!source) throw new NotFoundError();
  const view = buildQuestionPollView(source, viewerOf(ctx), now);
  return {
    space: { id: space.id, name: space.name },
    poll: {
      id: itemId("poll", space.id, view.id),
      question: view.question,
      open: view.isOpen,
      multiple: view.multiple,
      yourVotes: view.options.filter((o) => view.myVotes.includes(o.id)).map((o) => o.label),
      options: view.options.map((o) => ({ label: o.label, votes: o.votes })),
      voters: view.voterCount,
      url: pollHref(space.url(), "question", view.id),
    },
  };
}

export async function voteInPollTool(
  session: ConnectorSession,
  raw: z.input<typeof voteInput>,
  now: Date = new Date(),
): Promise<VoteOutput> {
  const args = voteInput.parse(raw);
  const ref = refOf(args.id, "poll");
  return writeInSpace(session, "vote_in_poll", ref.spaceId, POLLS, async (ctx, space) => {
    const source = await loadQuestionPollSource(ctx.db, space.id, ref.id, ctx.userId);
    if (!source) {
      const times = await ctx.db.availabilityPoll.findFirst({
        where: { id: ref.id, organizationId: space.id },
        select: { id: true },
      });
      if (!times) throw new NotFoundError();
      throw new ConnectorInputError(
        "This is a find-a-time poll: the member marks the times that work on its page in Bananasplit.",
      );
    }
    const byLabel = new Map(source.options.map((o) => [optionKey(o.label), o.id]));
    const optionIds = args.choices.map((label) => byLabel.get(optionKey(label)));
    if (optionIds.some((id) => id === undefined)) {
      throw new ConnectorInputError(
        "Each choice is one of the poll's options, as fetch lists them.",
      );
    }
    refuseOn(await setMyVotes(ctx, ref.id, optionIds, now));
    return {
      output: await pollOutput(ctx, space, ref.id, now),
      target: { type: "Poll", id: ref.id },
    };
  });
}

export const registerPollWrites: ToolRegistrar = (server, session) => {
  server.registerTool(
    "vote_in_poll",
    {
      title: "Vote in a poll",
      description:
        "Casts the member's vote on an open question poll: exactly the options given, by label, replacing an earlier vote; an empty list takes it back. Find-a-time polls are answered on their own page.",
      inputSchema: voteInput,
      outputSchema: voteOutput,
      annotations: OVERWRITES,
    },
    (args) => readResult("vote_in_poll", () => voteInPollTool(session, args)),
  );
};
