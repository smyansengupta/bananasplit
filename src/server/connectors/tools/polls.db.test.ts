// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * list_open_polls and a poll through fetch, against the real roles and
 * policies (src/test/connector-fixture.ts): question and find-a-time
 * polls, an anonymous poll that names nobody, results hidden until a poll
 * closes, each kind's own hidden section, and the denials every tool has.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { disconnectAll } from "@/server/db/clients";
import { ConnectorRefusedError } from "@/server/db/context";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { fetchItem } from "./fetch";
import { itemId } from "./ids";
import { listOpenPollsTool } from "./polls";
import { SectionHiddenError } from "./space";

const HOUR = 3_600_000;
let fx: ConnectorFixture | null = null;
const ids = { night: "", secret: "", blind: "", closed: "", times: "", chess: "" };

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-polls");
  if (!fx) return;
  const { alice, bob, club, other, tag } = fx;
  const poll = async (
    organizationId: string,
    question: string,
    data: Record<string, unknown> = {},
  ) => {
    const made = await ownerDb.poll.create({
      data: {
        organizationId,
        question,
        createdById: bob.id,
        options: {
          create: [
            { label: "Friday", sortOrder: 0 },
            { label: "Saturday", sortOrder: 1 },
          ],
        },
        ...data,
      },
      select: { id: true, options: { select: { id: true }, orderBy: { sortOrder: "asc" } } },
    });
    return { id: made.id, friday: made.options[0]!.id };
  };
  const night = await poll(club.id, `Which night for the gala ${tag}?`, {
    createdAt: new Date(Date.now() - 3 * HOUR),
  });
  ids.night = night.id;
  const secret = await poll(club.id, `Who should lead ${tag}?`, {
    anonymous: true,
    createdAt: new Date(Date.now() - 2 * HOUR),
  });
  ids.secret = secret.id;
  const blind = await poll(club.id, `Pick a theme ${tag}`, {
    hideResultsUntilClosed: true,
    createdAt: new Date(Date.now() - HOUR),
  });
  ids.blind = blind.id;
  ids.closed = (await poll(club.id, `Old question ${tag}`, { closedAt: new Date() })).id;
  ids.chess = (await poll(other.id, `Chess night ${tag}?`)).id;
  for (const [p, userId] of [
    [night, alice.id],
    [night, bob.id],
    [secret, bob.id],
    [blind, bob.id],
  ] as const) {
    await ownerDb.pollVote.create({
      data: { organizationId: club.id, pollId: p.id, optionId: p.friday, userId },
    });
  }

  const slotStart = new Date(Math.ceil((Date.now() + 48 * HOUR) / HOUR) * HOUR);
  const times = await ownerDb.availabilityPoll.create({
    data: {
      organizationId: club.id,
      title: `Find a time for the retro ${tag}`,
      timezone: "UTC",
      durationMinutes: 60,
      createdById: bob.id,
      slots: {
        create: [{ startsAt: slotStart, endsAt: new Date(slotStart.getTime() + HOUR) }],
      },
    },
    select: { id: true, slots: { select: { id: true } } },
  });
  ids.times = times.id;
  await ownerDb.pollResponse.create({
    data: {
      organizationId: club.id,
      pollId: times.id,
      slotId: times.slots[0]!.id,
      userId: alice.id,
      availability: "YES",
    },
  });
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("list_open_polls", () => {
  it("lists open polls of both kinds, newest first, with answers and the member's own", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const res = await listOpenPollsTool(await fx.session(alice), { space: club.id });
    expect(res.polls.map((p) => p.id)).toEqual([
      itemId("poll", club.id, ids.times),
      itemId("poll", club.id, ids.blind),
      itemId("poll", club.id, ids.secret),
      itemId("poll", club.id, ids.night),
    ]);
    expect(res.polls.find((p) => p.id === itemId("poll", club.id, ids.night))).toMatchObject({
      kind: "question",
      title: `Which night for the gala ${fx.tag}?`,
      answers: 2,
      youAnswered: true,
      url: `http://localhost:3000/app/${club.slug}/calendar/polls/${ids.night}`,
    });
    expect(res.polls[0]).toMatchObject({
      kind: "availability",
      answers: 1,
      youAnswered: true,
      url: `http://localhost:3000/app/${club.slug}/calendar/find-a-time/${ids.times}`,
    });
  });

  it("leaves out a kind whose section the organization hid, refuses when both are, and lets owners read", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const session = await fx.session(alice);
    // Find a time on its own (hiding Polls hides it too: it was split out of Polls).
    await fx.hiding(club.id, ["find-a-time"], async () => {
      const res = await listOpenPollsTool(session, { space: club.id });
      expect(res.polls.map((p) => p.kind)).toEqual(["question", "question", "question"]);
      await expect(
        fetchItem(session, { id: itemId("poll", club.id, ids.times) }),
      ).rejects.toBeInstanceOf(SectionHiddenError);
      expect(
        (await fetchItem(session, { id: itemId("poll", club.id, ids.night) })).metadata.pollKind,
      ).toBe("question");
    });
    await fx.hiding(club.id, ["polls", "find-a-time"], async () => {
      await expect(listOpenPollsTool(session, { space: club.id })).rejects.toBeInstanceOf(
        SectionHiddenError,
      );
      expect(
        (await listOpenPollsTool(await fx!.session(bob), { space: club.id })).polls,
      ).toHaveLength(4);
    });
  });

  it("reads a paused organization's polls, and refuses another org, the switch and another scope", async () => {
    if (!fx) return;
    const { alice, club, other, pausedId, personalId } = fx;
    const session = await fx.session(alice);
    expect((await listOpenPollsTool(session, { space: pausedId })).polls).toEqual([]);
    await expect(listOpenPollsTool(session, { space: other.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await fx.switchedOff(club.id, () =>
      expect(listOpenPollsTool(session, { space: club.id })).rejects.toBeInstanceOf(
        ConnectorRefusedError,
      ),
    );
    await expect(
      listOpenPollsTool(await fx.session(alice, { organizationId: personalId }), {
        space: club.id,
      }),
    ).rejects.toMatchObject({ reason: "scope" });
  });
});

describe("a poll through fetch", () => {
  it("reads a question with its counts and voters, as the poll page shows them", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const poll = await fetchItem(await fx.session(alice), {
      id: itemId("poll", club.id, ids.night),
    });
    expect(poll.metadata).toMatchObject({ kind: "poll", pollKind: "question", open: true });
    expect(poll.text).toContain(`- Friday: 2 votes (${alice.name}, ${bob.name}) (your vote)`);
    expect(poll.text).toContain("- Saturday: 0 votes");
  });

  it("names nobody on an anonymous poll, and hides counts until a poll that says so closes", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const session = await fx.session(alice);
    const secret = await fetchItem(session, { id: itemId("poll", club.id, ids.secret) });
    // Who asked shows, as on the poll page; who voted doesn't.
    expect(secret.text).toContain("- Friday: 1 vote\n");
    expect(secret.text).not.toContain(`(${bob.name})`);
    const blind = await fetchItem(session, { id: itemId("poll", club.id, ids.blind) });
    expect(blind.text).toContain("Results are hidden until it closes");
    expect(blind.text).not.toMatch(/Friday: \d/);
  });

  it("reads a find-a-time poll's times and who is free", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const times = await fetchItem(await fx.session(alice), {
      id: itemId("poll", club.id, ids.times),
    });
    expect(times).toMatchObject({
      title: `Find a time for the retro ${fx.tag}`,
      metadata: { pollKind: "availability", open: true },
    });
    expect(times.text).toContain(`free: ${alice.name}`);
  });

  it("answers another org's poll and a forged id as not found", async () => {
    if (!fx) return;
    const { alice, club, other } = fx;
    const session = await fx.session(alice);
    await expect(
      fetchItem(session, { id: itemId("poll", other.id, ids.chess) }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      fetchItem(session, { id: itemId("poll", club.id, ids.chess) }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("through the MCP server", () => {
  it("returns list_open_polls and both kinds of poll's fetch within their output schemas", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    const args = { space: fx.club.id };
    expect(await fx.call(session, "list_open_polls", args)).toEqual(
      asJson(await listOpenPollsTool(session, args)),
    );
    for (const id of [
      itemId("poll", fx.club.id, ids.night),
      itemId("poll", fx.club.id, ids.times),
    ]) {
      expect(await fx.call(session, "fetch", { id })).toEqual(
        asJson(await fetchItem(session, { id })),
      );
    }
  });
});
