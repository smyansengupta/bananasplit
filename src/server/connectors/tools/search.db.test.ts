// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * search and fetch against the real roles and policies
 * (src/test/connector-fixture.ts): one search over Personal and every club
 * the grant allows, each in its own transaction, and fetch on what it
 * finds. Never found: another member's private note or task, another
 * org's anything, the finance ledger; a scoped grant searches its space
 * only, and a club with AI apps off is skipped.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { NOT_FOUND_MESSAGE } from "@/server/connectors/errors";
import { disconnectAll } from "@/server/db/clients";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { fetchItem } from "./fetch";
import { itemId } from "./ids";
import { search } from "./search";

let fx: ConnectorFixture | null = null;
const ids = {
  diary: "",
  minutes: "",
  secretNote: "",
  venue: "",
  secretTask: "",
  gala: "",
  poll: "",
  leftovers: "",
  chessNote: "",
  deposit: "",
};

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-search");
  if (!fx) return;
  const { alice, bob, club, other, pausedId, personalId, tag } = fx;
  const note = async (
    organizationId: string,
    authorId: string,
    title: string,
    text: string,
    visibility: "PRIVATE" | "ORGANIZATION" = "ORGANIZATION",
  ) =>
    (
      await ownerDb.note.create({
        data: {
          organizationId,
          title,
          contentJson: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text }] }],
          },
          contentText: text,
          visibility,
          authorId,
          updatedById: authorId,
        },
        select: { id: true },
      })
    ).id;
  const task = async (organizationId: string, title: string, data: Record<string, unknown> = {}) =>
    (
      await ownerDb.task.create({
        data: { organizationId, title, rank: "a0", createdById: bob.id, ownerId: bob.id, ...data },
        select: { id: true },
      })
    ).id;
  ids.diary = await note(personalId, alice.id, `Gala diary ${tag}`, "What to wear.", "PRIVATE");
  ids.minutes = await note(club.id, bob.id, `Gala minutes ${tag}`, "We picked the ballroom.");
  ids.secretNote = await note(club.id, bob.id, `Gala secrets ${tag}`, "Surprise act.", "PRIVATE");
  ids.chessNote = await note(other.id, bob.id, `Gala at the chess club ${tag}`, "Not Alice's.");
  ids.venue = await task(club.id, `Book the gala venue ${tag}`, {
    description: "Call the hotel.",
    status: "BLOCKED",
    blockedReason: "Waiting on a quote",
  });
  ids.secretTask = await task(club.id, `Gala budget private ${tag}`, { visibility: "PRIVATE" });
  ids.leftovers = await task(pausedId, `Gala leftovers ${tag}`, {
    createdById: alice.id,
    ownerId: alice.id,
  });
  const startsAt = new Date(Date.now() + 7 * 86_400_000);
  ids.gala = (
    await ownerDb.event.create({
      data: {
        organizationId: club.id,
        title: `Spring gala ${tag}`,
        location: "Curry Student Center",
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3 * 3_600_000),
        createdById: bob.id,
      },
      select: { id: true },
    })
  ).id;
  ids.poll = (
    await ownerDb.poll.create({
      data: {
        organizationId: club.id,
        question: `Which night for the gala ${tag}?`,
        createdById: bob.id,
        options: { create: [{ label: "Friday" }, { label: "Saturday", sortOrder: 1 }] },
      },
      select: { id: true },
    })
  ).id;
  const period = await ownerDb.budgetPeriod.create({
    data: {
      organizationId: club.id,
      label: `FY ${tag}`,
      startsOn: new Date("2026-07-01"),
      endsOn: new Date("2027-06-30"),
    },
    select: { id: true },
  });
  ids.deposit = (
    await ownerDb.transaction.create({
      data: {
        organizationId: club.id,
        budgetPeriodId: period.id,
        direction: "OUT",
        kind: "EXPENSE",
        status: "SUBMITTED",
        amountCents: 45_000,
        description: `Gala deposit ${tag}`,
        occurredAt: new Date("2026-09-15T00:00:00Z"),
        submittedById: alice.id,
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

describe("search", () => {
  it("searches Personal and every club in one call, and never what the member can't see", async () => {
    if (!fx) return;
    const { alice, club, other, pausedId, personalId } = fx;
    const { results } = await search(await fx.session(alice), { query: `gala ${fx.tag}` });
    const found = results.map((r) => r.id);
    expect(found).toEqual(
      expect.arrayContaining([
        itemId("note", personalId, ids.diary),
        itemId("note", club.id, ids.minutes),
        itemId("task", club.id, ids.venue),
        itemId("event", club.id, ids.gala),
        itemId("poll", club.id, ids.poll),
        itemId("task", pausedId, ids.leftovers),
      ]),
    );
    for (const hidden of [
      itemId("note", club.id, ids.secretNote),
      itemId("task", club.id, ids.secretTask),
      itemId("note", other.id, ids.chessNote),
    ]) {
      expect(found).not.toContain(hidden);
    }
    // The ledger is not exposed, not even the member's own expense.
    expect(results.map((r) => r.title)).not.toContain(`Gala deposit ${fx.tag}`);
    expect(results.find((r) => r.id === itemId("note", club.id, ids.minutes))).toEqual({
      id: itemId("note", club.id, ids.minutes),
      title: `Gala minutes ${fx.tag}`,
      url: `http://localhost:3000/app/${club.slug}/notes/${ids.minutes}`,
      kind: "note",
      space: { id: club.id, name: `Robotics ${fx.tag}` },
      detail: expect.any(String),
    });
    expect(results.find((r) => r.space.id === personalId)?.space.name).toBe("Personal");

    expect(
      (await search(await fx.session(alice), { query: `gala ${fx.tag}`, limit: 2 })).results,
    ).toHaveLength(2);
    expect((await search(await fx.session(alice), { query: "!!!" })).results).toEqual([]);
  });

  it("searches only the scoped space, skips a club with AI apps off, and leaves out sections it hid", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const query = `gala ${fx.tag}`;
    const scoped = await search(await fx.session(alice, { organizationId: club.id }), { query });
    expect(new Set(scoped.results.map((r) => r.space.id))).toEqual(new Set([club.id]));

    const session = await fx.session(alice);
    await fx.switchedOff(club.id, async () => {
      const { results } = await search(session, { query });
      expect(results.length).toBeGreaterThan(0);
      expect(results.map((r) => r.space.id)).not.toContain(club.id);
    });

    await fx.hiding(club.id, ["notes"], async () => {
      const members = await search(session, { query });
      expect(
        members.results.filter((r) => r.space.id === club.id).map((r) => r.kind),
      ).not.toContain("note");
      const owners = await search(await fx!.session(bob), { query });
      expect(owners.results.map((r) => r.id)).toContain(itemId("note", club.id, ids.minutes));
    });
  });
});

describe("fetch", () => {
  it("opens what search found, each kind as text with its link", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    const note = await fetchItem(session, { id: itemId("note", club.id, ids.minutes) });
    expect(note).toMatchObject({
      title: `Gala minutes ${fx.tag}`,
      text: `# Gala minutes ${fx.tag}\n\nWe picked the ballroom.\n`,
      url: `http://localhost:3000/app/${club.slug}/notes/${ids.minutes}`,
      metadata: { kind: "note", spaceId: club.id, truncated: false },
    });
    const task = await fetchItem(session, { id: itemId("task", club.id, ids.venue) });
    expect(task.text).toContain("Status: Blocked (Waiting on a quote)");
    expect(task.text).toContain("Call the hotel.");
    const event = await fetchItem(session, { id: itemId("event", club.id, ids.gala) });
    expect(event.text).toContain("Where: Curry Student Center");
    expect(event.metadata).toMatchObject({ kind: "event", allDay: false });
  });

  it("answers a private item, another org's item, a forged id and a made-up id as not found", async () => {
    if (!fx) return;
    const { alice, club, other } = fx;
    const session = await fx.session(alice);
    for (const id of [
      itemId("note", club.id, ids.secretNote),
      itemId("task", club.id, ids.secretTask),
      itemId("note", other.id, ids.chessNote),
      itemId("note", club.id, ids.chessNote),
      "nonsense",
      `folder:${club.id}:x`,
    ]) {
      await expect(fetchItem(session, { id })).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});

describe("through the MCP server", () => {
  it("returns search and fetch within their output schemas", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    const args = { query: `gala ${fx.tag}` };
    const searched = (await fx.call(session, "search", args)) as { results: { id: string }[] };
    expect(searched).toEqual(asJson(await search(session, args)));
    for (const { id } of searched.results) {
      expect(await fx.call(session, "fetch", { id })).toEqual(
        asJson(await fetchItem(session, { id })),
      );
    }
    await expect(fx.call(session, "fetch", { id: "nonsense" })).rejects.toThrow(NOT_FOUND_MESSAGE);
  });
});
