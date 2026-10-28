// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * list_databases, query_database and a database through fetch, against the
 * real roles and policies (src/test/connector-fixture.ts): a club-made
 * database's rows as the grid shows them, a built-in one's filters and
 * sort, a database hidden from members, individual ballots, and the
 * denials every tool has.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { disconnectAll } from "@/server/db/clients";
import { ConnectorRefusedError } from "@/server/db/context";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { listDatabasesTool, queryDatabase } from "./databases";
import { fetchItem } from "./fetch";
import { itemId } from "./ids";
import { SectionHiddenError } from "./space";

let fx: ConnectorFixture | null = null;
const keys = { gear: "", hidden: "", chess: "" };

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-databases");
  if (!fx) return;
  const { alice, bob, club, other, tag } = fx;
  const database = async (
    organizationId: string,
    key: string,
    name: string,
    memberVisibility: "MEMBERS" | "HIDDEN" = "MEMBERS",
  ) =>
    (
      await ownerDb.databaseDefinition.create({
        data: {
          organizationId,
          key,
          name,
          kind: "CUSTOM",
          memberVisibility,
          description: `What ${name} tracks.`,
          createdById: bob.id,
        },
        select: { id: true },
      })
    ).id;
  keys.gear = `gear-${tag}`;
  const gear = await database(club.id, keys.gear, `Gear ${tag}`);
  const field = async (
    name: string,
    type: "TEXT" | "SELECT" | "MEMBER" | "CURRENCY",
    sortOrder: number,
    options: Record<string, unknown> = {},
  ) =>
    (
      await ownerDb.databaseField.create({
        data: {
          organizationId: club.id,
          databaseId: gear,
          name,
          type,
          options: options as object,
          isPrimary: sortOrder === 0,
          sortOrder,
        },
        select: { id: true },
      })
    ).id;
  const item = await field("Item", "TEXT", 0);
  const status = await field("Status", "SELECT", 1, {
    choices: [
      { id: "c_out", label: "Checked out", color: "blue" },
      { id: "c_in", label: "On the shelf", color: "green" },
    ],
  });
  const holder = await field("Holder", "MEMBER", 2);
  const cost = await field("Cost", "CURRENCY", 3);
  await ownerDb.databaseRecord.create({
    data: {
      organizationId: club.id,
      databaseId: gear,
      values: { [item]: "Soldering iron", [status]: "c_out", [holder]: alice.id, [cost]: 15.5 },
      createdById: bob.id,
      updatedById: bob.id,
      createdAt: new Date(Date.now() - 60_000),
    },
  });
  await ownerDb.databaseRecord.create({
    data: {
      organizationId: club.id,
      databaseId: gear,
      values: { [item]: "Oscilloscope", [status]: "c_in" },
      createdById: bob.id,
      updatedById: bob.id,
    },
  });
  keys.hidden = `board-only-${tag}`;
  await database(club.id, keys.hidden, `Board only ${tag}`, "HIDDEN");
  keys.chess = `ratings-${tag}`;
  await database(other.id, keys.chess, `Ratings ${tag}`);
  // The built-in Sessions database reads the club's events.
  for (const [title, days] of [
    [`Robot build ${tag}`, 3],
    [`Kickoff social ${tag}`, -3],
  ] as const) {
    await ownerDb.event.create({
      data: {
        organizationId: club.id,
        title,
        location: "Snell Library",
        startsAt: new Date(Date.now() + days * 86_400_000),
        endsAt: new Date(Date.now() + days * 86_400_000 + 3_600_000),
        createdById: bob.id,
      },
    });
  }
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("list_databases", () => {
  it("lists the built-in databases and the club's own, but not one hidden from members", async () => {
    if (!fx) return;
    const { alice, bob, club, personalId } = fx;
    const listed = await listDatabasesTool(await fx.session(alice), { space: club.id });
    const kinds = listed.databases.map((d) => d.kind);
    expect(kinds).toEqual(expect.arrayContaining(["sessions", "attendance", "custom"]));
    expect(listed.databases.find((d) => d.kind === "custom")).toEqual({
      id: itemId("database", club.id, keys.gear),
      name: `Gear ${fx.tag}`,
      kind: "custom",
      description: `What Gear ${fx.tag} tracks.`,
      url: `http://localhost:3000/app/${club.slug}/databases/${keys.gear}`,
    });
    expect(listed.databases.map((d) => d.id)).not.toContain(
      itemId("database", club.id, keys.hidden),
    );
    const owners = await listDatabasesTool(await fx.session(bob), { space: club.id });
    expect(owners.databases.map((d) => d.id)).toContain(itemId("database", club.id, keys.hidden));
    // Personal lists only the databases its owner makes (none here).
    expect(
      (await listDatabasesTool(await fx.session(alice), { space: personalId })).databases,
    ).toEqual([]);
  });
});

describe("query_database", () => {
  it("reads a club-made database's rows as the grid shows them, by words and page", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    const id = itemId("database", club.id, keys.gear);
    const res = await queryDatabase(session, { id });
    expect(res.columns.map((c) => c.key)).toEqual(["Item", "Status", "Holder", "Cost"]);
    expect(res.columns[1]).toMatchObject({
      type: "select",
      options: ["Checked out", "On the shelf"],
    });
    expect(res.total).toBe(2);
    expect(res.rows.map((r) => r.values)).toEqual([
      { Item: "Soldering iron", Status: "Checked out", Holder: alice.name, Cost: "$15.50" },
      { Item: "Oscilloscope", Status: "On the shelf", Holder: null, Cost: null },
    ]);

    const shelf = await queryDatabase(session, { id, query: "shelf" });
    expect(shelf.rows.map((r) => r.values.Item)).toEqual(["Oscilloscope"]);

    const first = await queryDatabase(session, { id, limit: 1 });
    const second = await queryDatabase(session, { id, limit: 1, cursor: first.nextCursor! });
    expect([first.rows[0]?.values.Item, second.rows[0]?.values.Item]).toEqual([
      "Soldering iron",
      "Oscilloscope",
    ]);
    expect(second.nextCursor).toBeNull();

    await expect(
      queryDatabase(session, { id, filters: [{ column: "Item", op: "eq", value: "x" }] }),
    ).rejects.toMatchObject({ name: "ConnectorInputError" });
  });

  it("filters and sorts a built-in database by its column keys, and says when a filter can't apply", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice);
    const sessions = (await listDatabasesTool(session, { space: club.id })).databases.find(
      (d) => d.kind === "sessions",
    )!;
    const all = await queryDatabase(session, {
      id: sessions.id,
      sort: { column: "startsAt", direction: "asc" },
    });
    expect(all.rows.map((r) => r.values.title)).toEqual([
      `Kickoff social ${fx.tag}`,
      `Robot build ${fx.tag}`,
    ]);
    const title = all.columns.find((c) => c.key === "title");
    expect(title).toMatchObject({ filterable: true, sortable: true });
    expect(title?.ops).toContain("contains");
    // A column hidden from members isn't listed for one.
    expect(all.columns.map((c) => c.key)).not.toContain("needsReview");

    const robots = await queryDatabase(session, {
      id: sessions.id,
      filters: [{ column: "title", op: "contains", value: "Robot" }],
    });
    expect(robots.rows.map((r) => r.values.title)).toEqual([`Robot build ${fx.tag}`]);
    await expect(
      queryDatabase(session, {
        id: sessions.id,
        filters: [{ column: "nonsense", op: "eq", value: "x" }],
      }),
    ).rejects.toMatchObject({ name: "ConnectorInputError" });
  });

  it("keeps individual ballots to the tier Privacy allows", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const ballots = (
      await listDatabasesTool(await fx.session(alice), { space: club.id })
    ).databases.find((d) => d.kind === "ballots")!;
    expect(ballots).toBeDefined();
    await expect(queryDatabase(await fx.session(alice), { id: ballots.id })).rejects.toMatchObject({
      name: "BallotRowsHiddenError",
    });
    expect((await queryDatabase(await fx.session(bob), { id: ballots.id })).rows).toEqual([]);
  });

  it("answers a hidden database, another org's and a forged id as not found", async () => {
    if (!fx) return;
    const { alice, club, other } = fx;
    const session = await fx.session(alice);
    for (const id of [
      itemId("database", club.id, keys.hidden),
      itemId("database", other.id, keys.chess),
      itemId("database", club.id, keys.chess),
    ]) {
      await expect(queryDatabase(session, { id })).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("reads a paused club's databases, and refuses the club switch, another scope and hidden Databases", async () => {
    if (!fx) return;
    const { alice, bob, club, pausedId, personalId } = fx;
    const session = await fx.session(alice);
    // A paused club still reads: it has the built-in databases every club gets.
    expect(
      (await listDatabasesTool(session, { space: pausedId })).databases.map((d) => d.kind),
    ).toContain("sessions");
    const id = itemId("database", club.id, keys.gear);
    await fx.switchedOff(club.id, () =>
      expect(queryDatabase(session, { id })).rejects.toBeInstanceOf(ConnectorRefusedError),
    );
    await expect(
      queryDatabase(await fx.session(alice, { organizationId: personalId }), { id }),
    ).rejects.toMatchObject({ reason: "scope" });
    await fx.hiding(club.id, ["databases"], async () => {
      await expect(queryDatabase(session, { id })).rejects.toBeInstanceOf(SectionHiddenError);
      expect((await queryDatabase(await fx!.session(bob), { id })).total).toBe(2);
    });
  });
});

describe("a database through fetch", () => {
  it("describes the database, its columns and how many rows it has", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const fetched = await fetchItem(await fx.session(alice), {
      id: itemId("database", club.id, keys.gear),
    });
    expect(fetched).toMatchObject({
      title: `Gear ${fx.tag}`,
      metadata: { kind: "database", type: "custom", rows: 2 },
    });
    expect(fetched.text).toContain("Status (select)");
    expect(fetched.text).not.toContain("Soldering iron");
  });
});

describe("through the MCP server", () => {
  it("returns list_databases, query_database and a database's fetch within their output schemas", async () => {
    if (!fx) return;
    const session = await fx.session(fx.alice);
    const list = { space: fx.club.id };
    expect(await fx.call(session, "list_databases", list)).toEqual(
      asJson(await listDatabasesTool(session, list)),
    );
    const sessions = (await listDatabasesTool(session, list)).databases.find(
      (d) => d.kind === "sessions",
    )!;
    for (const args of [
      { id: itemId("database", fx.club.id, keys.gear) },
      { id: sessions.id, sort: { column: "startsAt", direction: "asc" as const } },
    ]) {
      expect(await fx.call(session, "query_database", args)).toEqual(
        asJson(await queryDatabase(session, args)),
      );
    }
    const ballots = (await listDatabasesTool(session, list)).databases.find(
      (d) => d.kind === "ballots",
    )!;
    // A member who can't see individual ballots still reads what the database is.
    const fetched = await fx.call(session, "fetch", { id: ballots.id });
    expect(fetched).toMatchObject({ metadata: { kind: "database", type: "ballots", rows: null } });
    expect(fetched.text).toContain("private");
  });
});
