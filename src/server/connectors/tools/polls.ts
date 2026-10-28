import "server-only";

import { z } from "zod";

import { NotFoundError } from "@/lib/auth/errors";
import { can } from "@/lib/auth/permissions";
import { pollHref } from "@/lib/polls/paths";
import { buildPollView } from "@/lib/polls/poll-view";
import { buildQuestionPollView } from "@/lib/polls/question-poll";
import { getPollMemberNames, getPollSource } from "@/app/app/[orgSlug]/calendar/queries";
import type { OrgContext } from "@/server/db/context";
import { listOpenPolls } from "@/server/polls/open-polls";
import { loadQuestionPollSource, pollVoteCounts } from "@/server/polls/question-polls";

import { decodeCursor, listFingerprint, pageOf } from "./cursor";
import { itemId, type ItemRef } from "./ids";
import {
  cursorArg,
  limitArg,
  nextCursor,
  READ_ONLY,
  readResult,
  spaceArg,
  spaceRef,
  urlField,
  type ConnectorSession,
  type FetchedItem,
  type ToolRegistrar,
} from "./shared";
import { inSpace, type ToolSpace } from "./space";
import { zonedIso } from "./text";

/**
 * list_open_polls and a poll for fetch (docs/features/ai-connectors.md):
 * question polls (Polls) and find-a-time polls (Find a time), each refused
 * to members when the club hid its section. A poll reads as its page
 * shows it to this member: the app's own views decide when counts are
 * hidden until it closes, and an anonymous poll names nobody.
 */

const POLLS = { feature: "polls" } as const;

/** Open polls are few; the list reads them all and pages in memory. */
const MAX_OPEN = 500;

const openPoll = z.object({
  id: z.string().describe("The poll's id, for fetch."),
  kind: z
    .enum(["question", "availability"])
    .describe("A question to vote on, or a find-a-time poll of times to mark."),
  title: z.string(),
  closesAt: z.string().nullable(),
  askedAt: z.string(),
  answers: z.number().int().describe("How many people have voted or marked times."),
  youAnswered: z.boolean(),
  url: urlField,
});

const listOutput = z.object({
  space: spaceRef,
  polls: z.array(openPoll),
  nextCursor,
});

function sectionOf(kind: "question" | "availability") {
  return kind === "question" ? "polls" : "find-a-time";
}

/** Who has answered each poll, and whether this member has. */
async function answers(ctx: OrgContext, spaceId: string, polls: { id: string; kind: string }[]) {
  const questions = polls.filter((p) => p.kind === "question").map((p) => p.id);
  const times = polls.filter((p) => p.kind === "availability").map((p) => p.id);
  const count = new Map<string, number>();
  const mine = new Set<string>();
  // One after another: a transaction has one connection.
  if (questions.length > 0) {
    for (const row of await pollVoteCounts(ctx.db, questions)) count.set(row.pollId, row.voters);
    const voted = await ctx.db.pollVote.findMany({
      where: { organizationId: spaceId, pollId: { in: questions }, userId: ctx.userId },
      select: { pollId: true },
    });
    for (const v of voted) mine.add(v.pollId);
  }
  if (times.length > 0) {
    // One row per person who marked a time (a NO reads as unmarked, as on the polls list).
    const people = await ctx.db.pollResponse.groupBy({
      by: ["pollId", "userId", "guestKeyHash", "guestName"],
      where: { organizationId: spaceId, pollId: { in: times }, availability: { not: "NO" } },
    });
    for (const p of people) {
      count.set(p.pollId, (count.get(p.pollId) ?? 0) + 1);
      if (p.userId === ctx.userId) mine.add(p.pollId);
    }
  }
  return { count, mine };
}

const listInput = z.object({ space: spaceArg, limit: limitArg, cursor: cursorArg });

export async function listOpenPollsTool(
  session: ConnectorSession,
  raw: z.input<typeof listInput>,
  now: Date = new Date(),
): Promise<z.infer<typeof listOutput>> {
  const args = listInput.parse(raw);
  const list = listFingerprint("list_open_polls", { space: args.space });
  const position = decodeCursor(args.cursor, list);
  return inSpace(session, args.space, POLLS, async (ctx, space) => {
    if (!space.opens("polls") && !space.opens("find-a-time")) space.requireSection("polls");
    const open = (await listOpenPolls(ctx.db, space.id, now, MAX_OPEN)).filter((p) =>
      space.opens(sectionOf(p.kind)),
    );
    const page = pageOf(
      open.slice(position.offset, position.offset + args.limit + 1),
      args.limit,
      list,
      position,
    );
    const { count, mine } = await answers(ctx, space.id, page.items);
    return {
      space: { id: space.id, name: space.name },
      polls: page.items.map((p) => ({
        id: itemId("poll", space.id, p.id),
        kind: p.kind,
        title: p.title,
        closesAt: p.closesAt ? zonedIso(p.closesAt, space.zone) : null,
        askedAt: zonedIso(p.createdAt, space.zone),
        answers: count.get(p.id) ?? 0,
        youAnswered: mine.has(p.id),
        url: pollHref(space.url(), p.kind, p.id),
      })),
      nextCursor: page.nextCursor,
    };
  });
}

// ---------------------------------------------------------------- fetch

async function questionText(ctx: OrgContext, space: ToolSpace, pollId: string, now: Date) {
  const source = await loadQuestionPollSource(ctx.db, space.id, pollId, ctx.userId);
  if (!source) return null;
  space.requireSection("polls");
  const view = buildQuestionPollView(
    source,
    {
      userId: ctx.userId,
      isAdmin: can({ role: ctx.role }, "events.write"),
      profile: { name: ctx.user.name ?? null, image: null, avatar: null },
    },
    now,
  );
  const options = view.options.map((o) => {
    const votes = o.votes === null ? "" : `: ${o.votes} ${o.votes === 1 ? "vote" : "votes"}`;
    const who =
      o.voters && o.voters.length > 0 ? ` (${o.voters.map((v) => v.name).join(", ")})` : "";
    const yours = view.myVotes.includes(o.id) ? " (your vote)" : "";
    return `- ${o.label}${votes}${who}${yours}`;
  });
  const facts = [
    view.isOpen ? "Open" : "Closed",
    view.closesAt && view.isOpen && `Closes: ${zonedIso(view.closesAt, space.zone)}`,
    view.askedBy && `Asked by: ${view.askedBy}`,
    view.multiple ? "More than one choice allowed" : "One choice",
    view.anonymous && "Anonymous: votes aren't shown by name",
    !view.resultsVisible && "Results are hidden until it closes",
    `${view.voterCount} ${view.voterCount === 1 ? "person has" : "people have"} voted`,
  ].filter(Boolean);
  return {
    title: view.question,
    text: [`# ${view.question}`, view.description, facts.join("\n"), options.join("\n")]
      .filter(Boolean)
      .join("\n\n"),
    kind: "question" as const,
    open: view.isOpen,
  };
}

const slotFormat = (zone: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  });

async function availabilityText(ctx: OrgContext, space: ToolSpace, pollId: string, now: Date) {
  const poll = await getPollSource(ctx.db, space.id, pollId, now);
  if (!poll) return null;
  space.requireSection("find-a-time");
  const memberNames = await getPollMemberNames(ctx.db, space.id, poll);
  const view = buildPollView(poll, { kind: "member", userId: ctx.userId }, { memberNames });
  const when = slotFormat(space.zone);
  const slots = view.slots.map((slot) => {
    const marks = view.responses.filter((r) => r.slotId === slot.id);
    const yes = marks.filter((r) => r.availability === "YES").map((r) => r.label);
    const ifNeeded = marks.filter((r) => r.availability === "IF_NEEDED").map((r) => r.label);
    const parts = [
      yes.length > 0 && `free: ${yes.join(", ")}`,
      ifNeeded.length > 0 && `if needed: ${ifNeeded.join(", ")}`,
    ].filter(Boolean);
    return `- ${when.format(slot.startsAt)}${parts.length > 0 ? ` (${parts.join("; ")})` : ""}`;
  });
  const open = !view.isFinalized && !(view.closesAt && view.closesAt <= now);
  const facts = [
    view.isFinalized ? "Scheduled" : open ? "Open" : "Closed",
    view.scheduled && `Scheduled for: ${when.format(view.scheduled.startsAt)}`,
    `Length: ${view.durationMinutes} minutes`,
    view.closesAt && open && `Closes: ${zonedIso(view.closesAt, space.zone)}`,
    `Times are in ${space.zone}`,
  ].filter(Boolean);
  return {
    title: view.title,
    text: [`# ${view.title}`, view.description, facts.join("\n"), slots.join("\n")]
      .filter(Boolean)
      .join("\n\n"),
    kind: "availability" as const,
    open,
  };
}

/** A poll for fetch: a question with its options and counts, or a find-a-time poll's times. */
export async function fetchPoll(session: ConnectorSession, ref: ItemRef): Promise<FetchedItem> {
  const now = new Date();
  const { poll, space } = await inSpace(session, ref.spaceId, POLLS, async (ctx, space) => {
    // Either kind has the id: as the poll page does, a question first.
    const poll =
      (await questionText(ctx, space, ref.id, now)) ??
      (await availabilityText(ctx, space, ref.id, now));
    if (!poll) throw new NotFoundError();
    return { poll, space };
  });
  return {
    id: itemId("poll", space.id, ref.id),
    title: poll.title,
    text: poll.text,
    url: pollHref(space.url(), poll.kind, ref.id),
    metadata: {
      kind: "poll",
      spaceId: space.id,
      space: space.name,
      pollKind: poll.kind,
      open: poll.open,
    },
  };
}

export const registerPollTools: ToolRegistrar = (server, session) => {
  server.registerTool(
    "list_open_polls",
    {
      title: "List open polls",
      description:
        "Lists the polls still open in one space, newest first: questions to vote on and find-a-time polls, with how many have answered and whether the member has.",
      inputSchema: listInput,
      outputSchema: listOutput,
      annotations: READ_ONLY,
    },
    (args) => readResult("list_open_polls", () => listOpenPollsTool(session, args)),
  );
};
