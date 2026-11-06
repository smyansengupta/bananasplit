// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Club-made databases against the real roles, policies and functions on the
 * local database: who reads and edits what (app.can_view_database,
 * app.can_edit_database), that another club sees nothing, that cell saves
 * merge, and what type changes, deleting fields, the trash and CSV import
 * do. Two throwaway clubs are made as the table owner and removed in
 * afterAll. Skipped when the database is not reachable.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock, getSession: vi.fn() }));
vi.mock("@/server/cache/invalidate", () => ({ invalidate: vi.fn() }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, type OrgContext } from "@/server/db/context";
import { disconnectOwnerDb, ownerDb } from "@/test/owner-db";

import { choicesVersion } from "@/lib/databases/fields";
import { parseDelimited } from "@/lib/finance/import/sheet";

import {
  addChoice,
  addField,
  createDatabase,
  createRecord,
  DatabaseInputError,
  deleteField,
  importDatabase,
  loadCustomDatabase,
  loadRecords,
  purgeRecords,
  restoreRecords,
  trashRecords,
  updateCell,
  updateDatabaseSettings,
  updateField,
  type Actor,
} from "./custom";
import { NotFoundError } from "@/lib/auth/errors";

import { linkedFrom, searchRelationTargets } from "./relations";
import { getDatabase, listDatabases } from "./views";

const tag = randomBytes(4).toString("hex");
const orgA = `c_dbtest_a_${tag}`;
const orgB = `c_dbtest_b_${tag}`;
const personalOrg = `c_dbtest_p_${tag}`;

type U = { id: string; email: string; name: string };
let ownerA: U;
let memberA: U;
let ownerB: U;
let personalOwner: U;
let reachable = true;

async function makeUser(local: string): Promise<U> {
  const email = `${local}-${tag}@example.edu`;
  const row = await authDb.user.create({
    data: { email, name: local, emailVerified: new Date(), onboardedAt: new Date() },
    select: { id: true, email: true, name: true },
  });
  return { id: row.id, email: row.email, name: row.name ?? local };
}

/** As a user in an org, on the member path (RLS applies). */
function as<T>(
  user: U,
  org: string,
  fn: (actor: Actor, ctx: OrgContext) => Promise<T>,
): Promise<T> {
  requireUserMock.mockResolvedValue(user);
  return withOrgTx(org, (ctx) =>
    fn({ db: ctx.db, organizationId: org, userId: user.id, role: ctx.role }, ctx),
  );
}

beforeAll(async () => {
  try {
    ownerA = await makeUser("db-owner-a");
    memberA = await makeUser("db-member-a");
    ownerB = await makeUser("db-owner-b");
    personalOwner = await makeUser("db-personal");
    await ownerDb.organization.createMany({
      data: [
        { id: orgA, name: "DB Test A", slug: `db-test-a-${tag}`, timezone: "UTC" },
        { id: orgB, name: "DB Test B", slug: `db-test-b-${tag}`, timezone: "UTC" },
        {
          id: personalOrg,
          name: "DB Test Personal",
          slug: `db-test-p-${tag}`,
          timezone: "UTC",
          kind: "PERSONAL",
          plan: "FREE",
          personalOwnerId: personalOwner.id,
        },
      ],
    });
    await ownerDb.membership.createMany({
      data: [
        { organizationId: orgA, userId: ownerA.id, role: "OWNER" },
        { organizationId: orgA, userId: memberA.id, role: "MEMBER" },
        { organizationId: orgB, userId: ownerB.id, role: "OWNER" },
        { organizationId: personalOrg, userId: personalOwner.id, role: "OWNER" },
      ],
    });
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  if (reachable) {
    await ownerDb.organization.deleteMany({ where: { id: { in: [orgA, orgB, personalOrg] } } });
    await ownerDb.user.deleteMany({
      where: {
        id: { in: [ownerA, memberA, ownerB, personalOwner].filter(Boolean).map((u) => u.id) },
      },
    });
  }
  await disconnectAll();
  await disconnectOwnerDb();
});

async function newRoster(name: string) {
  const { key } = await as(ownerA, orgA, (a) => createDatabase(a, { name, templateId: "roster" }));
  const db = await as(ownerA, orgA, (a) => loadCustomDatabase(a, key));
  const field = (n: string) => db.fields.find((f) => f.name === n)!;
  return { key, id: db.id, field, fields: db.fields };
}

/** A row's stored values, read as the table owner. */
async function valuesOf(id: string): Promise<Record<string, unknown>> {
  return (await ownerDb.databaseRecord.findUniqueOrThrow({ where: { id } })).values as Record<
    string,
    unknown
  >;
}

describe("club-made databases against the local database", () => {
  it("makes a database from a template, saves cells as they're edited, and reads them back", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Roster ${tag}`);
    expect(roster.fields.map((f) => f.name)).toEqual([
      "Name",
      "Email",
      "Phone",
      "Year",
      "Major",
      "Dues paid",
      "Joined",
    ]);
    expect(roster.fields[0]!.isPrimary).toBe(true);

    const row = await as(ownerA, orgA, (a) => createRecord(a, roster.id));
    await as(ownerA, orgA, (a) => updateCell(a, row.id, roster.field("Name").id, "  Maya Patel "));
    await as(ownerA, orgA, (a) =>
      updateCell(a, row.id, roster.field("Email").id, "Maya@Example.EDU"),
    );
    await as(ownerA, orgA, (a) =>
      updateCell(a, row.id, roster.field("Phone").id, "(617) 555-0101"),
    );
    await as(ownerA, orgA, (a) => updateCell(a, row.id, roster.field("Year").id, "Third year"));
    await as(ownerA, orgA, (a) => updateCell(a, row.id, roster.field("Dues paid").id, true));

    const loaded = await as(ownerA, orgA, (a) => loadCustomDatabase(a, roster.key));
    const year = roster.field("Year").options.choices!.find((c) => c.label === "Third year")!;
    expect(loaded.records[0]!.values).toEqual({
      [roster.field("Name").id]: "Maya Patel",
      [roster.field("Email").id]: "maya@example.edu",
      [roster.field("Phone").id]: "+16175550101",
      [roster.field("Year").id]: year.id,
      [roster.field("Dues paid").id]: true,
    });
    // Clearing a cell removes the key.
    await as(ownerA, orgA, (a) => updateCell(a, row.id, roster.field("Dues paid").id, null));
    const after = await ownerDb.databaseRecord.findUniqueOrThrow({ where: { id: row.id } });
    expect(Object.keys(after.values as object)).not.toContain(roster.field("Dues paid").id);
  });

  it("refuses values that don't fit the field", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Strict ${tag}`);
    const row = await as(ownerA, orgA, (a) => createRecord(a, roster.id));
    await expect(
      as(ownerA, orgA, (a) => updateCell(a, row.id, roster.field("Email").id, "not-an-email")),
    ).rejects.toBeInstanceOf(DatabaseInputError);
    await expect(
      as(ownerA, orgA, (a) => updateCell(a, row.id, roster.field("Year").id, "Tenth year")),
    ).rejects.toBeInstanceOf(DatabaseInputError);
    const member = await as(ownerA, orgA, (a) =>
      addField(a, roster.id, { name: "Buddy", type: "MEMBER" }),
    );
    await expect(
      as(ownerA, orgA, (a) => updateCell(a, row.id, member.id, ownerB.id)),
    ).rejects.toBeInstanceOf(DatabaseInputError);
    await as(ownerA, orgA, (a) => updateCell(a, row.id, member.id, memberA.id));
  });

  it("merges two people's edits to different cells of one row", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Merge ${tag}`);
    const row = await as(ownerA, orgA, (a) => createRecord(a, roster.id));
    await Promise.all([
      as(ownerA, orgA, (a) => updateCell(a, row.id, roster.field("Name").id, "Jay Thompson")),
      as(ownerA, orgA, (a) => updateCell(a, row.id, roster.field("Major").id, "Economics")),
      as(ownerA, orgA, (a) => updateCell(a, row.id, roster.field("Email").id, "jay@example.edu")),
    ]);
    const values = (await ownerDb.databaseRecord.findUniqueOrThrow({ where: { id: row.id } }))
      .values as Record<string, unknown>;
    expect(values[roster.field("Name").id]).toBe("Jay Thompson");
    expect(values[roster.field("Major").id]).toBe("Economics");
    expect(values[roster.field("Email").id]).toBe("jay@example.edu");
  });

  it("lets members read but not edit, until the database allows it; fields and deleting for good stay admin-only", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Members ${tag}`);
    const row = await as(ownerA, orgA, (a) =>
      createRecord(a, roster.id, { [roster.field("Name").id]: "Sam Okafor" }),
    );

    const seen = await as(memberA, orgA, (a) => loadCustomDatabase(a, roster.key));
    expect(seen.records).toHaveLength(1);
    expect(seen.canEdit).toBe(false);
    await expect(
      as(memberA, orgA, (a) => updateCell(a, row.id, roster.field("Major").id, "Physics")),
    ).rejects.toBeInstanceOf(DatabaseInputError);
    // Straight through the database: RLS hides the row from the UPDATE and refuses the INSERT.
    const sneaky = await as(memberA, orgA, (_a, ctx) =>
      ctx.db.databaseRecord.updateMany({ where: { id: row.id }, data: { values: {} } }),
    );
    expect(sneaky.count).toBe(0);
    await expect(
      as(memberA, orgA, (_a, ctx) =>
        ctx.db.databaseRecord.create({
          data: {
            organizationId: orgA,
            databaseId: roster.id,
            values: {},
            createdById: memberA.id,
          },
        }),
      ),
    ).rejects.toThrow();

    await as(ownerA, orgA, (a) =>
      updateDatabaseSettings(a, roster.id, {
        name: `Members ${tag}`,
        description: null,
        memberVisibility: "MEMBERS",
        memberCanEdit: true,
      }),
    );
    const mine = await as(memberA, orgA, (a) =>
      createRecord(a, roster.id, { [roster.field("Name").id]: "Priya Shah" }),
    );
    await as(memberA, orgA, (a) => updateCell(a, row.id, roster.field("Major").id, "Physics"));
    await as(memberA, orgA, (a) => trashRecords(a, roster.id, [mine.id]));
    await expect(
      as(memberA, orgA, (a) => purgeRecords(a, roster.id, [mine.id])),
    ).rejects.toBeInstanceOf(DatabaseInputError);
    await expect(
      as(memberA, orgA, (a) => addField(a, roster.id, { name: "Sneaky", type: "TEXT" })),
    ).rejects.toBeInstanceOf(DatabaseInputError);
    await expect(
      as(memberA, orgA, (_a, ctx) =>
        ctx.db.databaseField.create({
          data: { organizationId: orgA, databaseId: roster.id, name: "Sneaky", type: "TEXT" },
        }),
      ),
    ).rejects.toThrow();
  });

  it("hides an admins-only database from members everywhere", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Private ${tag}`);
    await as(ownerA, orgA, (a) =>
      createRecord(a, roster.id, { [roster.field("Name").id]: "Secret" }),
    );
    await as(ownerA, orgA, (a) =>
      updateDatabaseSettings(a, roster.id, {
        name: `Private ${tag}`,
        description: null,
        memberVisibility: "ADMINS",
        memberCanEdit: false,
      }),
    );
    await expect(as(memberA, orgA, (a) => loadCustomDatabase(a, roster.key))).rejects.toThrow();
    const rows = await as(memberA, orgA, (_a, ctx) =>
      ctx.db.databaseRecord.findMany({ where: { databaseId: roster.id } }),
    );
    expect(rows).toEqual([]);
    const fields = await as(memberA, orgA, (_a, ctx) =>
      ctx.db.databaseField.findMany({ where: { databaseId: roster.id } }),
    );
    expect(fields).toEqual([]);
    const listed = await as(memberA, orgA, (_a, ctx) => listDatabases(ctx.db, orgA, ctx.role));
    expect(listed.map((d) => d.key)).not.toContain(roster.key);
  });

  it("shows another organization nothing, and can't be written into from another organization", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Walled ${tag}`);
    const row = await as(ownerA, orgA, (a) =>
      createRecord(a, roster.id, { [roster.field("Name").id]: "Organization A only" }),
    );
    const peek = await as(ownerB, orgB, (_a, ctx) =>
      Promise.all([
        ctx.db.databaseRecord.findMany({ where: { id: row.id } }),
        ctx.db.databaseField.findMany({ where: { databaseId: roster.id } }),
        ctx.db.databaseDefinition.findMany({ where: { id: roster.id } }),
      ]),
    );
    expect(peek).toEqual([[], [], []]);
    await expect(
      as(ownerB, orgB, (a) => updateCell(a, row.id, roster.field("Name").id, "Hacked")),
    ).rejects.toThrow();
    await expect(
      as(ownerB, orgB, (_a, ctx) =>
        ctx.db.databaseRecord.create({
          data: { organizationId: orgB, databaseId: roster.id, values: {}, createdById: ownerB.id },
        }),
      ),
    ).rejects.toThrow();
    const still = await ownerDb.databaseRecord.findUniqueOrThrow({ where: { id: row.id } });
    expect((still.values as Record<string, unknown>)[roster.field("Name").id]).toBe(
      "Organization A only",
    );
  });

  it("keeps rows only in club-made databases, never in the built-ins", async () => {
    if (!reachable) return;
    const sessions = await ownerDb.databaseDefinition.findFirst({
      where: { organizationId: orgA, kind: "SESSIONS" },
    });
    if (!sessions) return;
    await expect(
      ownerDb.databaseRecord.create({
        data: { organizationId: orgA, databaseId: sessions.id, values: {} },
      }),
    ).rejects.toThrow(/not a club-made database/);
  });

  it("lists only the databases a Personal space makes, never the built-ins it was made with", async () => {
    if (!reachable) return;
    // Every space gets the built-ins at creation (app.ensure_org_defaults)...
    const builtIns = await ownerDb.databaseDefinition.count({
      where: { organizationId: personalOrg, kind: { not: "CUSTOM" } },
    });
    expect(builtIns).toBeGreaterThan(0);
    // ...but Personal doesn't list them, or open one by its key.
    expect(
      await as(personalOwner, personalOrg, (a) => listDatabases(a.db, personalOrg, a.role)),
    ).toEqual([]);
    await expect(
      as(personalOwner, personalOrg, (a) => getDatabase(a.db, personalOrg, a.role, "sessions")),
    ).rejects.toBeInstanceOf(NotFoundError);

    const { key } = await as(personalOwner, personalOrg, (a) =>
      createDatabase(a, { name: `Reading list ${tag}`, templateId: "spreadsheet" }),
    );
    const listed = await as(personalOwner, personalOrg, (a) =>
      listDatabases(a.db, personalOrg, a.role),
    );
    expect(listed.map((d) => [d.key, d.kind])).toEqual([[key, "CUSTOM"]]);
    expect(listed[0]!.canEdit).toBe(true);

    // A club still lists its built-ins, and nobody else opens the Personal space.
    const club = await as(ownerA, orgA, (a) => listDatabases(a.db, orgA, a.role));
    expect(club.some((d) => d.kind === "SESSIONS")).toBe(true);
    await expect(
      as(ownerA, personalOrg, (a) => listDatabases(a.db, personalOrg, a.role)),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("converts values when a field's type changes, and deleting a field clears its values", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Types ${tag}`);
    const major = roster.field("Major");
    const r1 = await as(ownerA, orgA, (a) => createRecord(a, roster.id, { [major.id]: "12" }));
    const r2 = await as(ownerA, orgA, (a) => createRecord(a, roster.id, { [major.id]: "Physics" }));
    await as(ownerA, orgA, (a) => updateField(a, major.id, { type: "NUMBER" }));
    const values = async (id: string) =>
      (await ownerDb.databaseRecord.findUniqueOrThrow({ where: { id } })).values as Record<
        string,
        unknown
      >;
    expect((await values(r1.id))[major.id]).toBe(12);
    expect((await values(r2.id))[major.id]).toBeUndefined();

    await as(ownerA, orgA, (a) => deleteField(a, roster.field("Phone").id));
    await expect(
      as(ownerA, orgA, (a) => deleteField(a, roster.field("Name").id)),
    ).rejects.toBeInstanceOf(DatabaseInputError);
  });

  it("moves rows to the trash, restores them, and deletes them for good", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Trash ${tag}`);
    const row = await as(ownerA, orgA, (a) => createRecord(a, roster.id));
    await as(ownerA, orgA, (a) => trashRecords(a, roster.id, [row.id]));
    expect((await as(ownerA, orgA, (a) => loadCustomDatabase(a, roster.key))).records).toHaveLength(
      0,
    );
    expect(
      (await as(ownerA, orgA, (a) => loadCustomDatabase(a, roster.key, { trash: true }))).records,
    ).toHaveLength(1);
    await as(ownerA, orgA, (a) => restoreRecords(a, roster.id, [row.id]));
    await as(ownerA, orgA, (a) => trashRecords(a, roster.id, [row.id]));
    expect(await as(ownerA, orgA, (a) => purgeRecords(a, roster.id, "all"))).toBe(1);
    expect(await ownerDb.databaseRecord.count({ where: { id: row.id } })).toBe(0);
  });

  it("imports a spreadsheet as a database, guessing each column's type", async () => {
    if (!reachable) return;
    const csv = [
      "Item,Qty,Price,Paid,Size,Email",
      "T-shirt,2,$15.00,yes,M,a@x.test",
      "Hoodie,1,$35.50,no,L,b@x.test",
      "T-shirt,3,$15.00,yes,S,c@x.test",
      "Sticker,10,$2.00,no,M,d@x.test",
      "Hoodie,1,$35.50,yes,M,e@x.test",
      "T-shirt,1,$15.00,yes,L,f@x.test",
    ].join("\n");
    const summary = await as(ownerA, orgA, (a) =>
      importDatabase(a, { name: `Merch ${tag}`, rows: parseDelimited(csv).rows }),
    );
    expect(summary).toMatchObject({ rows: 6, fields: 6, skippedCells: 0 });
    const db = await as(ownerA, orgA, (a) => loadCustomDatabase(a, summary.key));
    expect(db.fields.map((f) => f.type)).toEqual([
      "TEXT",
      "NUMBER",
      "CURRENCY",
      "CHECKBOX",
      "SELECT",
      "EMAIL",
    ]);
    const price = db.fields[2]!;
    expect(db.records[1]!.values[price.id]).toBe(35.5);
  });

  it("imports phone numbers and ids as written, and keeps a number's decimals", async () => {
    if (!reachable) return;
    const csv = [
      "Name,Phone,Student ID,Score",
      "Maya,5551234567,001234567,3.14159",
      "Jay,5559876543,002345678,2.5",
    ].join("\n");
    const summary = await as(ownerA, orgA, (a) =>
      importDatabase(a, { name: `Ids ${tag}`, rows: parseDelimited(csv).rows }),
    );
    const db = await as(ownerA, orgA, (a) => loadCustomDatabase(a, summary.key));
    expect(db.fields.map((f) => f.type)).toEqual(["TEXT", "PHONE", "TEXT", "NUMBER"]);
    expect(db.fields[3]!.options.decimals).toBeUndefined();
    const [phone, id, score] = db.fields.slice(1);
    expect(db.records[0]!.values).toMatchObject({
      [phone!.id]: "+15551234567",
      [id!.id]: "001234567",
      [score!.id]: 3.1416,
    });
  });

  it("changes a type by what the cells show: choices and members become names, never ids", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Convert ${tag}`);
    const year = roster.field("Year");
    const major = roster.field("Major");
    const buddy = await as(ownerA, orgA, (a) =>
      addField(a, roster.id, { name: "Buddy", type: "MEMBER" }),
    );
    const r1 = await as(ownerA, orgA, (a) =>
      createRecord(a, roster.id, {
        [year.id]: "Third year",
        [buddy.id]: memberA.id,
        [major.id]: "Physics",
      }),
    );
    const r2 = await as(ownerA, orgA, (a) => createRecord(a, roster.id, { [major.id]: "12" }));

    const toText = await as(ownerA, orgA, (a) => updateField(a, year.id, { type: "TEXT" }));
    expect(toText.cleared).toBe(0);
    expect((await valuesOf(r1.id))[year.id]).toBe("Third year");

    await as(ownerA, orgA, (a) => updateField(a, buddy.id, { type: "LONG_TEXT" }));
    expect((await valuesOf(r1.id))[buddy.id]).toBe(memberA.name);

    // "Physics" can't be a number: cleared, and counted. The row's other cells stay.
    const toNumber = await as(ownerA, orgA, (a) => updateField(a, major.id, { type: "NUMBER" }));
    expect(toNumber.cleared).toBe(1);
    expect(await valuesOf(r1.id)).toEqual({
      [year.id]: "Third year",
      [buddy.id]: memberA.name,
    });
    expect((await valuesOf(r2.id))[major.id]).toBe(12);
  });

  it("turns text into a select of at most 100 choices across thousands of rows at once, counting what it couldn't keep", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Bulk ${tag}`);
    const name = roster.field("Name");
    const major = roster.field("Major");
    // 100 common majors, 109 one-offs, and one too long to be a choice.
    const majorOf = (i: number) =>
      i < 4890 ? `Major ${i % 100}` : i < 4999 ? `Rare ${i}` : "x".repeat(90);
    await ownerDb.databaseRecord.createMany({
      data: Array.from({ length: 5000 }, (_, i) => ({
        organizationId: orgA,
        databaseId: roster.id,
        values: { [name.id]: `Row ${i}`, [major.id]: majorOf(i) },
      })),
    });
    // One transaction (10 seconds at most), one statement per thousand rows.
    const result = await as(ownerA, orgA, (a) => updateField(a, major.id, { type: "SELECT" }));
    const choices = result.field.options.choices!;
    expect(choices).toHaveLength(100);
    expect(choices.every((c) => c.label.startsWith("Major "))).toBe(true);
    expect(result.cleared).toBe(110);

    const rows = await ownerDb.databaseRecord.findMany({
      where: { databaseId: roster.id },
      select: { values: true },
    });
    const ids = new Set(choices.map((c) => c.id));
    const values = rows.map((r) => r.values as Record<string, unknown>);
    expect(values.filter((v) => ids.has(v[major.id] as string))).toHaveLength(4890);
    expect(values.filter((v) => major.id in v)).toHaveLength(4890);
    expect(values.every((v) => typeof v[name.id] === "string")).toBe(true);
  }, 30_000);

  it("adds choices without losing anyone else's, and refuses a choice list saved from a stale copy", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Choices ${tag}`);
    const year = roster.field("Year");
    const loaded = choicesVersion(year.options.choices);

    // Two admins add a choice each at the same moment, from the same copy.
    const [fifth, alumni] = await Promise.all([
      as(ownerA, orgA, (a) => addChoice(a, year.id, "Fifth year")),
      as(ownerA, orgA, (a) => addChoice(a, year.id, "Alumni")),
    ]);
    const again = await as(ownerA, orgA, (a) => addChoice(a, year.id, "  fifth YEAR "));
    expect(again.choice.id).toBe(fifth.choice.id);
    const labels = again.field.options.choices!.map((c) => c.label);
    expect(labels).toEqual(expect.arrayContaining(["Grad", "Fifth year", "Alumni"]));
    expect(labels).toHaveLength(7);

    // Saving the whole list from the copy loaded before those adds is refused...
    await expect(
      as(ownerA, orgA, (a) =>
        updateField(a, year.id, {
          options: { choices: year.options.choices },
          choicesVersion: loaded,
        }),
      ),
    ).rejects.toThrow(/Someone else changed these choices/);
    expect(
      (await as(ownerA, orgA, (a) => loadCustomDatabase(a, roster.key))).fields
        .find((f) => f.id === year.id)!
        .options.choices!.map((c) => c.label),
    ).toEqual(labels);

    // ...and from the current one it saves, clearing a removed choice from its rows.
    const row = await as(ownerA, orgA, (a) =>
      createRecord(a, roster.id, { [year.id]: alumni.choice.id }),
    );
    const current = choicesVersion(again.field.options.choices);
    const kept = again.field.options.choices!.filter((c) => c.id !== alumni.choice.id);
    const renamed = again.field.options.choices!.map((c) =>
      c.id === fifth.choice.id ? { ...c, label: "Fifth-year" } : c,
    );
    // Two saves from the same copy: one wins, the other is told to reload.
    const saves = await Promise.allSettled([
      as(ownerA, orgA, (a) =>
        updateField(a, year.id, { options: { choices: kept }, choicesVersion: current }),
      ),
      as(ownerA, orgA, (a) =>
        updateField(a, year.id, { options: { choices: renamed }, choicesVersion: current }),
      ),
    ]);
    expect(saves.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(saves.filter((s) => s.status === "rejected")).toHaveLength(1);
    if (saves[0]!.status === "fulfilled") {
      expect(saves[0].value.cleared).toBe(1);
      expect((await valuesOf(row.id))[year.id]).toBeUndefined();
    }

    // Members don't shape fields.
    await expect(as(memberA, orgA, (a) => addChoice(a, year.id, "Sneaky"))).rejects.toBeInstanceOf(
      DatabaseInputError,
    );
  });

  it("pages through every row in order, and pages the trash", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Pages ${tag}`);
    const name = roster.field("Name");
    const start = Date.UTC(2026, 0, 1, 12);
    // Three rows to each millisecond: the id settles their order.
    await ownerDb.databaseRecord.createMany({
      data: Array.from({ length: 1203 }, (_, i) => ({
        organizationId: orgA,
        databaseId: roster.id,
        values: { [name.id]: `Row ${i}` },
        createdAt: new Date(start + Math.floor(i / 3)),
      })),
    });
    const first = await as(ownerA, orgA, (a) => loadCustomDatabase(a, roster.key));
    expect(first.records).toHaveLength(500);
    expect(first.total).toBe(1203);
    const seen = [...first.records];
    let next = first.next;
    while (next) {
      const after = next;
      const page = await as(ownerA, orgA, (a) => loadRecords(a, roster.id, { after }));
      expect(page.total).toBe(1203);
      seen.push(...page.records);
      next = page.next;
    }
    expect(seen).toHaveLength(1203);
    expect(new Set(seen.map((r) => r.id)).size).toBe(1203);
    const order = seen.map((r) => [r.createdAt, r.id].join(" "));
    expect([...order].sort()).toEqual(order);

    // The trash: most recently deleted first, three at the same moment.
    await as(ownerA, orgA, (a) =>
      trashRecords(
        a,
        roster.id,
        seen.slice(0, 3).map((r) => r.id),
      ),
    );
    const t1 = await as(ownerA, orgA, (a) => loadRecords(a, roster.id, { trash: true, limit: 2 }));
    expect(t1.records).toHaveLength(2);
    expect(t1.total).toBe(3);
    const t2 = await as(ownerA, orgA, (a) =>
      loadRecords(a, roster.id, { trash: true, limit: 2, after: t1.next }),
    );
    expect(t2.records).toHaveLength(1);
    expect(t2.next).toBeNull();
    expect(new Set([...t1.records, ...t2.records].map((r) => r.id)).size).toBe(3);
    expect((await as(ownerA, orgA, (a) => loadRecords(a, roster.id, {}))).total).toBe(1200);

    await expect(
      as(ownerA, orgA, (a) => loadRecords(a, roster.id, { after: "page-2" })),
    ).rejects.toBeInstanceOf(DatabaseInputError);
    // Another club can't page it.
    await expect(as(ownerB, orgB, (a) => loadRecords(a, roster.id, {}))).rejects.toThrow();
  });

  it("searches every field on the server, by what the grid shows", async () => {
    if (!reachable) return;
    const roster = await newRoster(`Search ${tag}`);
    const f = roster.field;
    const buddy = await as(ownerA, orgA, (a) =>
      addField(a, roster.id, { name: "Buddy", type: "MEMBER" }),
    );
    const dues = await as(ownerA, orgA, (a) =>
      addField(a, roster.id, { name: "Dues", type: "CURRENCY" }),
    );
    const tags = await as(ownerA, orgA, (a) =>
      addField(a, roster.id, {
        name: "Tags",
        type: "MULTI_SELECT",
        options: {
          choices: [
            { id: "t_board", label: "Board", color: "blue" },
            { id: "t_alum", label: "Alum 100%", color: "gray" },
          ],
        },
      }),
    );
    const add = (values: Record<string, unknown>) =>
      as(ownerA, orgA, (a) => createRecord(a, roster.id, values));
    await add({
      [f("Name").id]: "Maya Patel",
      [f("Year").id]: "Third year",
      [f("Major").id]: "Physics",
      [buddy.id]: memberA.id,
      [dues.id]: "15.5",
      [tags.id]: ["t_board"],
    });
    await add({
      [f("Name").id]: "Jay Thompson",
      [f("Dues paid").id]: true,
      [f("Major").id]: "Economics_101",
      [tags.id]: ["t_alum"],
    });
    await add({ [f("Name").id]: "Sam Okafor", [f("Major").id]: "1000 Organization" });

    const find = async (q: string) =>
      (await as(ownerA, orgA, (a) => loadRecords(a, roster.id, { q }))).records
        .map((r) => r.values[f("Name").id])
        .sort();
    expect(await find("PHYSICS")).toEqual(["Maya Patel"]);
    expect(await find("third")).toEqual(["Maya Patel"]); // a choice's label
    expect(await find("member-a")).toEqual(["Maya Patel"]); // a member's name
    expect(await find("$15.5")).toEqual(["Maya Patel"]); // money as shown
    expect(await find("board")).toEqual(["Maya Patel"]); // a multi-select's label
    expect(await find("yes")).toEqual(["Jay Thompson"]); // a ticked box
    // % and _ are plain characters, not wildcards.
    expect(await find("100%")).toEqual(["Jay Thompson"]);
    expect(await find("_")).toEqual(["Jay Thompson"]);
    // Ids are never matched: not a choice's, not a member's.
    const third = f("Year").options.choices!.find((c) => c.label === "Third year")!;
    expect(await find(third.id)).toEqual([]);
    expect(await find(memberA.id)).toEqual([]);
    // The count is of the matches.
    const page = await as(ownerA, orgA, (a) => loadRecords(a, roster.id, { q: "o" }));
    expect(page.total).toBe(page.records.length);
    expect(page.total).toBe(3);
  });
});

describe("relation fields against the local database", () => {
  it("links a row of another database, refuses another organization's, and finds the link from the other side", async () => {
    if (!reachable) return;
    const events = await as(ownerA, orgA, (a) =>
      createDatabase(a, { name: `Events ${tag}`, templateId: "blank" }),
    );
    const eventsDb = await as(ownerA, orgA, (a) => loadCustomDatabase(a, events.key));
    const gala = await as(ownerA, orgA, (a) =>
      createRecord(a, eventsDb.id, { [eventsDb.fields[0]!.id]: "Spring gala" }),
    );

    const gifts = await as(ownerA, orgA, (a) =>
      createDatabase(a, { name: `Gifts ${tag}`, templateId: "blank" }),
    );
    const giftsDb = await as(ownerA, orgA, (a) => loadCustomDatabase(a, gifts.key));
    const event = await as(ownerA, orgA, (a) =>
      addField(a, giftsDb.id, {
        name: "Event",
        type: "RELATION",
        options: { target: { kind: "record", databaseId: eventsDb.id } },
      }),
    );
    const amount = await as(ownerA, orgA, (a) =>
      addField(a, giftsDb.id, { name: "Amount", type: "CURRENCY" }),
    );
    // A relation must say what it links to.
    await expect(
      as(ownerA, orgA, (a) => addField(a, giftsDb.id, { name: "Bad", type: "RELATION" })),
    ).rejects.toBeInstanceOf(DatabaseInputError);

    const link = [{ kind: "record", id: gala.id }];
    await as(ownerA, orgA, (a) =>
      createRecord(a, giftsDb.id, {
        [giftsDb.fields[0]!.id]: "Harbor Light",
        [event.id]: link,
        [amount.id]: "250",
      }),
    );
    const second = await as(ownerA, orgA, (a) =>
      createRecord(a, giftsDb.id, { [giftsDb.fields[0]!.id]: "Alder" }),
    );
    expect(await as(ownerA, orgA, (a) => updateCell(a, second.id, event.id, link))).toEqual(link);
    await as(ownerA, orgA, (a) => updateCell(a, second.id, amount.id, 100));

    // The grid gets the linked row's name with the rows.
    const loaded = await as(ownerA, orgA, (a) => loadCustomDatabase(a, gifts.key));
    expect(loaded.labels[`record:${gala.id}`]?.label).toBe("Spring gala");

    // Another organization's row, or a made-up id, can't be linked.
    const { key: otherKey } = await as(ownerB, orgB, (a) =>
      createDatabase(a, { name: `Other ${tag}`, templateId: "blank" }),
    );
    const otherDb = await as(ownerB, orgB, (a) => loadCustomDatabase(a, otherKey));
    const theirs = await as(ownerB, orgB, (a) => createRecord(a, otherDb.id));
    await expect(
      as(ownerA, orgA, (a) =>
        updateCell(a, second.id, event.id, [{ kind: "record", id: theirs.id }]),
      ),
    ).rejects.toBeInstanceOf(DatabaseInputError);
    await expect(
      as(ownerA, orgA, (a) => updateCell(a, second.id, event.id, [{ kind: "person", id: "x" }])),
    ).rejects.toBeInstanceOf(DatabaseInputError);

    // From the gala's side: both gifts, with their amounts added up.
    const groups = await as(ownerA, orgA, (a) =>
      linkedFrom(a.db, orgA, `db-test-a-${tag}`, { kind: "record", id: gala.id }),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.fieldName).toBe("Event");
    expect(groups[0]!.count).toBe(2);
    expect(groups[0]!.rows.map((r) => r.label).sort()).toEqual(["Alder", "Harbor Light"]);
    expect(groups[0]!.rollups).toContainEqual({
      fieldName: "Amount",
      kind: "sum",
      value: 350,
      money: true,
    });
    // Another organization sees none of it.
    const fromB = await as(ownerB, orgB, (a) =>
      linkedFrom(a.db, orgB, `db-test-b-${tag}`, { kind: "record", id: gala.id }),
    );
    expect(fromB).toEqual([]);

    // The picker finds the gala by name.
    const found = await as(ownerA, orgA, (a) =>
      searchRelationTargets(a.db, orgA, { kind: "record", databaseId: eventsDb.id, q: "gala" }),
    );
    expect(found.map((f) => f.id)).toEqual([gala.id]);
  });
});
