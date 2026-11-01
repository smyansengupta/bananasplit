// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * add_database_record and update_database_record against the real roles
 * and policies (src/test/connector-fixture.ts): rows of a club-made
 * database by column key, each value checked by its column as the grid
 * checks it, and audited; a database the member may only view, a built-in
 * one, one hidden from members, and a row of another database. The
 * wrapper's own refusals are in write.db.test.ts.
 */

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { NotFoundError } from "@/lib/auth/errors";
import { disconnectAll } from "@/server/db/clients";
import { asJson, setUpConnectorFixture, type ConnectorFixture } from "@/test/connector-fixture";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { addDatabaseRecordTool, updateDatabaseRecordTool } from "./database-writes";
import { listDatabasesTool } from "./databases";
import { itemId } from "./ids";
import { WriteRefusedError } from "./write";

let fx: ConnectorFixture | null = null;
const keys = { gear: "", ledger: "", hidden: "" };
const ids = { gear: "", ledger: "", row: "", ledgerRow: "", item: "", status: "" };

beforeAll(async () => {
  fx = await setUpConnectorFixture("tool-database-writes");
  if (!fx) return;
  const { bob, club, tag } = fx;
  const database = async (
    key: string,
    name: string,
    data: { memberCanEdit?: boolean; memberVisibility?: "MEMBERS" | "HIDDEN" } = {},
  ) =>
    (
      await ownerDb.databaseDefinition.create({
        data: { organizationId: club.id, key, name, kind: "CUSTOM", createdById: bob.id, ...data },
        select: { id: true },
      })
    ).id;
  const field = async (
    databaseId: string,
    name: string,
    type: "TEXT" | "SELECT" | "MEMBER" | "CURRENCY" | "DATE",
    sortOrder: number,
    options: Record<string, unknown> = {},
  ) =>
    (
      await ownerDb.databaseField.create({
        data: {
          organizationId: club.id,
          databaseId,
          name,
          type,
          options: options as object,
          isPrimary: sortOrder === 0,
          sortOrder,
        },
        select: { id: true },
      })
    ).id;
  keys.gear = `gear-${tag}`;
  ids.gear = await database(keys.gear, `Gear ${tag}`, { memberCanEdit: true });
  ids.item = await field(ids.gear, "Item", "TEXT", 0);
  ids.status = await field(ids.gear, "Status", "SELECT", 1, {
    choices: [
      { id: "c_out", label: "Checked out", color: "blue" },
      { id: "c_in", label: "On the shelf", color: "green" },
    ],
  });
  await field(ids.gear, "Holder", "MEMBER", 2);
  await field(ids.gear, "Cost", "CURRENCY", 3);
  await field(ids.gear, "Due back", "DATE", 4);
  ids.row = (
    await ownerDb.databaseRecord.create({
      data: {
        organizationId: club.id,
        databaseId: ids.gear,
        values: { [ids.item]: "Soldering iron", [ids.status]: "c_in" },
        createdById: bob.id,
        updatedById: bob.id,
      },
      select: { id: true },
    })
  ).id;
  keys.ledger = `ledger-${tag}`;
  ids.ledger = await database(keys.ledger, `Ledger ${tag}`);
  const entry = await field(ids.ledger, "Entry", "TEXT", 0);
  ids.ledgerRow = (
    await ownerDb.databaseRecord.create({
      data: {
        organizationId: club.id,
        databaseId: ids.ledger,
        values: { [entry]: "Dues" },
        createdById: bob.id,
        updatedById: bob.id,
      },
      select: { id: true },
    })
  ).id;
  keys.hidden = `board-${tag}`;
  await database(keys.hidden, `Board ${tag}`, { memberCanEdit: true, memberVisibility: "HIDDEN" });
});

afterAll(async () => {
  await fx?.cleanup();
  await disconnectAll();
  await disconnectOwnerDb();
});

describe("add_database_record", () => {
  it("adds a row by column key, as the grid shows it, and audits it", async () => {
    if (!fx) return;
    const { alice, club, tag } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const res = await addDatabaseRecordTool(session, {
      id: itemId("database", club.id, keys.gear),
      values: {
        Item: "Oscilloscope",
        Status: "checked out",
        Holder: "me",
        Cost: "15.5",
        "Due back": "2026-11-30",
      },
    });
    expect(res).toEqual({
      space: { id: club.id, name: `Robotics ${tag}` },
      database: {
        id: itemId("database", club.id, keys.gear),
        name: `Gear ${tag}`,
        url: `http://localhost:3000/app/${club.slug}/databases/${keys.gear}`,
      },
      row: {
        id: res.row.id,
        values: {
          Item: "Oscilloscope",
          Status: "Checked out",
          Holder: alice.name,
          Cost: "$15.50",
          "Due back": expect.stringContaining("2026"),
        },
      },
    });
    // One after another: the owner client has a small pool.
    const row = await ownerDb.databaseRecord.findUniqueOrThrow({
      where: { id: res.row.id },
      select: { createdById: true, values: true },
    });
    expect(row.createdById).toBe(alice.id);
    expect(row.values).toMatchObject({ [ids.item]: "Oscilloscope", [ids.status]: "c_out" });
    expect(
      await ownerDb.orgAuditLog.findFirst({
        where: { organizationId: club.id, action: "connector.add_database_record" },
        select: { actorId: true, targetType: true, targetId: true },
      }),
    ).toEqual({ actorId: alice.id, targetType: "DatabaseRecord", targetId: res.row.id });
  });

  it("refuses a value its column won't take, and an unknown column, and adds nothing", async () => {
    if (!fx) return;
    const { alice, bob, club, other } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const id = itemId("database", club.id, keys.gear);
    const before = await ownerDb.databaseRecord.count({ where: { databaseId: ids.gear } });
    await expect(
      addDatabaseRecordTool(session, { id, values: { Status: "Lost at sea" } }),
    ).rejects.toThrow(new WriteRefusedError("Status: Pick one of the choices."));
    await expect(
      addDatabaseRecordTool(session, { id, values: { Colour: "Red" } }),
    ).rejects.toMatchObject({ name: "ConnectorInputError" });
    await expect(
      addDatabaseRecordTool(session, {
        id,
        values: { Holder: itemId("person", other.id, bob.id) },
      }),
    ).rejects.toMatchObject({ name: "ConnectorInputError" });
    expect(await ownerDb.databaseRecord.count({ where: { databaseId: ids.gear } })).toBe(before);
  });

  it("refuses a database the member may only view, and every built-in one", async () => {
    if (!fx) return;
    const { alice, bob, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    await expect(
      addDatabaseRecordTool(session, {
        id: itemId("database", club.id, keys.ledger),
        values: { Entry: "Snacks" },
      }),
    ).rejects.toThrow(new WriteRefusedError("You can view this database but not edit it."));
    const sessions = (await listDatabasesTool(session, { space: club.id })).databases.find(
      (d) => d.kind === "sessions",
    )!;
    await expect(
      addDatabaseRecordTool(await fx.session(bob, { access: "WRITE" }), {
        id: sessions.id,
        values: {},
      }),
    ).rejects.toThrow(/Only databases the club made/);
    // Owners and admins edit any club-made database.
    await expect(
      addDatabaseRecordTool(await fx.session(bob, { access: "WRITE" }), {
        id: itemId("database", club.id, keys.ledger),
        values: { Entry: "Snacks" },
      }),
    ).resolves.toMatchObject({ row: { values: { Entry: "Snacks" } } });
  });

  it("answers a database hidden from members, and another club's, as not found", async () => {
    if (!fx) return;
    const { alice, club, other } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    for (const id of [
      itemId("database", club.id, keys.hidden),
      itemId("database", club.id, `nope-${fx.tag}`),
    ]) {
      await expect(addDatabaseRecordTool(session, { id, values: {} })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    }
    await expect(
      addDatabaseRecordTool(session, { id: itemId("database", other.id, keys.gear), values: {} }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("update_database_record", () => {
  it("sets the cells given, clears one with null, keeps the rest, and audits it", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const res = await updateDatabaseRecordTool(session, {
      id: itemId("database", club.id, keys.gear),
      row: ids.row,
      values: { Status: "Checked out", Holder: "me", Cost: 20 },
    });
    expect(res.row).toEqual({
      id: ids.row,
      values: {
        Item: "Soldering iron",
        Status: "Checked out",
        Holder: alice.name,
        Cost: "$20.00",
        "Due back": null,
      },
    });
    const cleared = await updateDatabaseRecordTool(session, {
      id: itemId("database", club.id, keys.gear),
      row: ids.row,
      values: { Holder: null },
    });
    expect(cleared.row.values).toMatchObject({ Status: "Checked out", Holder: null });
    const row = await ownerDb.databaseRecord.findUniqueOrThrow({
      where: { id: ids.row },
      select: { updatedById: true },
    });
    expect(row.updatedById).toBe(alice.id);
    expect(
      await ownerDb.orgAuditLog.count({
        where: {
          organizationId: club.id,
          action: "connector.update_database_record",
          targetId: ids.row,
        },
      }),
    ).toBe(2);
  });

  it("answers a row of another database as not found, and refuses a view-only one", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    await expect(
      updateDatabaseRecordTool(session, {
        id: itemId("database", club.id, keys.gear),
        row: ids.ledgerRow,
        values: { Item: "Swapped" },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      updateDatabaseRecordTool(session, {
        id: itemId("database", club.id, keys.ledger),
        row: ids.ledgerRow,
        values: { Entry: "Changed" },
      }),
    ).rejects.toBeInstanceOf(WriteRefusedError);
    const ledger = await ownerDb.databaseRecord.findUniqueOrThrow({
      where: { id: ids.ledgerRow },
      select: { values: true },
    });
    expect(Object.values(ledger.values as object)).toEqual(["Dues"]);
  });

  it("rolls every cell back when one of them is refused", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const before = await ownerDb.databaseRecord.findUniqueOrThrow({
      where: { id: ids.row },
      select: { values: true },
    });
    await expect(
      updateDatabaseRecordTool(session, {
        id: itemId("database", club.id, keys.gear),
        row: ids.row,
        values: { Item: "Renamed", Cost: "a lot" },
      }),
    ).rejects.toBeInstanceOf(WriteRefusedError);
    const after = await ownerDb.databaseRecord.findUniqueOrThrow({
      where: { id: ids.row },
      select: { values: true },
    });
    expect(after.values).toEqual(before.values);
  });
});

describe("through the MCP server", () => {
  it("returns both tools' results within their output schemas", async () => {
    if (!fx) return;
    const { alice, club } = fx;
    const session = await fx.session(alice, { access: "WRITE" });
    const id = itemId("database", club.id, keys.gear);
    const added = await fx.call(session, "add_database_record", {
      id,
      values: { Item: "Multimeter" },
    });
    const row = (added.row as { id: string }).id;
    const args = { id, row, values: { Status: "On the shelf" } };
    expect(await fx.call(session, "update_database_record", args)).toEqual(
      asJson(await updateDatabaseRecordTool(session, args)),
    );
  });
});
