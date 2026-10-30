// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * vote_in_poll against the real roles and policies
 * (src/test/connector-fixture.ts): the member's vote by label, replacing
 * the earlier one or taken back, read back as the poll page shows it, and
 * audited; too many choices, an option that isn't there, a closed poll, a
 * find-a-time poll and another club's poll. The wrapper's own refusals are
 * in write.db.test.ts.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { disconnectAll } from "@/server/db/clients";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { itemId } from "./ids";
import { voteInPollTool } from "./poll-writes";
import { WriteRefusedError } from "./write";

let fx: ConnectorFixture | null = null;
const ids = { night: "", snacks: "", blind: "", closed: "", times: "", chess: "" };

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-poll-writes");
  if (!fx) return;
  const { bob, club, other, tag } = fx;
  const poll = async (
    organizationId: string,
    question: string,
    labels: string[],
    data: Record<string, unknown> = {},
  ) =>
    (
      await ownerDb.poll.create({
        data: {
          organizationId,
          question,
          createdById: bob.id,
          options: { create: labels.map((label, sortOrder) => ({ label, sortOrder })) },
          ...data,
        },
        select: { id: true },
      })
    ).id;
  // One after another: the owner client has a small pool.
  ids.night = await poll(club.id, `Which night ${tag}?`, ["Friday", "Saturday"]);
  ids.snacks = await poll(club.id, `Snacks ${tag}?`, ["Chips", "Fruit", "Cookies"], {
    multiple: true,
  });
  ids.blind = await poll(club.id, `Theme ${tag}?`, ["Space", "Ocean"], {
    hideResultsUntilClosed: true,
  });
  ids.closed = await poll(club.id, `Old question ${tag}?`, ["Yes", "No"], {
    closedAt: new Date(),
  });
  ids.chess = await poll(other.id, `Chess night ${tag}?`, ["Friday", "Saturday"]);
  const slotStart = new Date(Date.now() + 3 * 86_400_000);
  ids.times = (
    await ownerDb.availabilityPoll.create({
      data: {
        organizationId: club.id,
        title: `Find a time ${tag}`,
        timezone: "UTC",
        durationMinutes: 60,
        createdById: bob.id,
        slots: {
          create: [{ startsAt: slotStart, endsAt: new Date(slotStart.getTime() + 3_600_000) }],
        },
      },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

/** The member's votes on a poll, as option labels. */
async function myVotes(pollId: string, userId: string): Promise<string[]> {
  const votes = await ownerDb.pollVote.findMany({
    where: { pollId, userId },
    select: { option: { select: { label: true } } },
  });
  return votes.map((v) => v.option.label).sort();
}

describe("vote_in_poll", () => {
  it("votes by label, replaces the vote, takes it back, and audits each", async () => {
    if (!fx) return;
    const { alice, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const id = itemId("poll", club.id, ids.night);
    const voted = await voteInPollTool(session, { id, choices: ["saturday"] });
    expect(voted).toEqual({
      space: { id: club.id, name: `Robotics ${tag}` },
      poll: {
        id,
        question: `Which night ${tag}?`,
        open: true,
        multiple: false,
        yourVotes: ["Saturday"],
        options: [
          { label: "Friday", votes: 0 },
          { label: "Saturday", votes: 1 },
        ],
        voters: 1,
        url: `http://localhost:3000/app/${club.slug}/calendar/polls/${ids.night}`,
      },
    });
    // One after another: the owner client has a small pool.
    expect(await myVotes(ids.night, alice.id)).toEqual(["Saturday"]);
    await voteInPollTool(session, { id, choices: ["Friday"] });
    expect(await myVotes(ids.night, alice.id)).toEqual(["Friday"]);
    const cleared = await voteInPollTool(session, { id, choices: [] });
    expect(cleared.poll).toMatchObject({ yourVotes: [], voters: 0 });
    expect(await myVotes(ids.night, alice.id)).toEqual([]);
    expect(
      await ownerDb.orgAuditLog.findMany({
        where: { organizationId: club.id, action: "connector.vote_in_poll" },
        select: { actorId: true, targetType: true, targetId: true },
      }),
    ).toEqual(Array(3).fill({ actorId: alice.id, targetType: "Poll", targetId: ids.night }));
  });

  it("takes several choices on a multiple-choice poll, and keeps counts hidden when the poll says so", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const snacks = await voteInPollTool(session, {
      id: itemId("poll", club.id, ids.snacks),
      choices: ["Cookies", "Chips"],
    });
    expect(snacks.poll.yourVotes).toEqual(["Chips", "Cookies"]);
    const blind = await voteInPollTool(session, {
      id: itemId("poll", club.id, ids.blind),
      choices: ["Ocean"],
    });
    expect(blind.poll).toMatchObject({
      yourVotes: ["Ocean"],
      options: [
        { label: "Space", votes: null },
        { label: "Ocean", votes: null },
      ],
    });
  });

  it("refuses two choices on a single-choice poll, an option it doesn't have, and a closed poll", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    await expect(
      voteInPollTool(session, {
        id: itemId("poll", club.id, ids.night),
        choices: ["Friday", "Saturday"],
      }),
    ).rejects.toEqual(new WriteRefusedError("Pick one option."));
    await expect(
      voteInPollTool(session, { id: itemId("poll", club.id, ids.night), choices: ["Sunday"] }),
    ).rejects.toMatchObject({ name: "ConnectorInputError" });
    await expect(
      voteInPollTool(session, { id: itemId("poll", club.id, ids.closed), choices: ["Yes"] }),
    ).rejects.toEqual(new WriteRefusedError("This poll is closed. Votes can't change any more."));
    expect(await myVotes(ids.night, alice.id)).toEqual([]);
    expect(await myVotes(ids.closed, alice.id)).toEqual([]);
  });

  it("sends a find-a-time poll to its page, and answers another club's poll as not found", async () => {
    if (!fx) return;
    const { alice, club, other } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    await expect(
      voteInPollTool(session, { id: itemId("poll", club.id, ids.times), choices: [] }),
    ).rejects.toThrow(/find-a-time poll/);
    for (const id of [itemId("poll", other.id, ids.chess), itemId("poll", club.id, ids.chess)]) {
      await expect(voteInPollTool(session, { id, choices: ["Friday"] })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
  });

  it("returns its result within its output schema through the MCP server", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice, { access: "WRITE" });
    const args = { id: itemId("poll", fx.club.id, ids.night), choices: ["Friday"] };
    expect(await fx.call(session, "vote_in_poll", args)).toEqual(
      asJson(await voteInPollTool(session, args)),
    );
  });
});
