import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/auth/errors";
import type { TxClient } from "@/server/db/context";

import { DatabaseInputError, deleteDatabase, type Actor } from "./custom";

/**
 * deleteDatabase against a fake transaction: who may delete (the setting,
 * the role, editing rights), what never goes (built-ins, a form's answers),
 * and that it deletes within the caller's organization, audited. The
 * database's own DELETE policy is exercised in prisma/rls/phases.mjs
 * (P-DBDEL-01).
 */

interface State {
  def: { id: string; key?: string; name: string; kind: string; archivedAt: Date | null } | null;
  forms: number;
  membersCanDelete: boolean;
  canView: boolean;
  canEdit: boolean;
  deleted: number;
}

let state: State;

function fakeDb() {
  return {
    databaseDefinition: {
      findFirst: vi.fn(async () => state.def),
      deleteMany: vi.fn(async () => ({ count: state.deleted })),
    },
    form: { count: vi.fn(async () => state.forms) },
    orgSettings: {
      findUnique: vi.fn(async () => ({ memberCanDeleteDatabases: state.membersCanDelete })),
    },
    databaseRecord: {
      count: vi.fn(async () => 12),
      findMany: vi.fn(async () => [{ id: "rec_1" }]),
    },
    itemLink: {
      findMany: vi.fn(async () => [
        { fromKind: "task", fromId: "t_1", toKind: "record", toId: "rec_1" },
      ]),
      deleteMany: vi.fn(async () => ({ count: 1 })),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ..._values: unknown[]) => {
      const sql = strings.join("?");
      if (sql.includes("can_view_database")) return [{ ok: state.canView }];
      if (sql.includes("can_edit_database")) return [{ ok: state.canEdit }];
      return [{ id: "audit" }];
    }),
  };
}

let db: ReturnType<typeof fakeDb>;
const actor = (role: Actor["role"]): Actor => ({
  db: db as unknown as TxClient,
  organizationId: "org_1",
  userId: "u_1",
  role,
});

beforeEach(() => {
  state = {
    def: { id: "db_1", key: "roster", name: "Roster", kind: "CUSTOM", archivedAt: null },
    forms: 0,
    membersCanDelete: false,
    canView: true,
    canEdit: true,
    deleted: 1,
  };
  db = fakeDb();
});

describe("deleteDatabase", () => {
  it("deletes an organization's own database within the organization, audited", async () => {
    await deleteDatabase(actor("ADMIN"), "db_1");
    expect(db.databaseDefinition.deleteMany).toHaveBeenCalledWith({
      where: { id: "db_1", organizationId: "org_1" },
    });
    const audit = db.$queryRaw.mock.calls.find((c) => String(c[0]).includes("write_org_audit"));
    expect(audit?.[2]).toBe("database.deleted");
  });

  it("refuses a member while the setting is off, and deletes nothing", async () => {
    await expect(deleteDatabase(actor("MEMBER"), "db_1")).rejects.toThrow(
      "Only owners and admins can delete databases.",
    );
    expect(db.databaseDefinition.deleteMany).not.toHaveBeenCalled();
  });

  it("lets a member who can edit it delete while the setting is on", async () => {
    state.membersCanDelete = true;
    await deleteDatabase(actor("MEMBER"), "db_1");
    expect(db.databaseDefinition.deleteMany).toHaveBeenCalled();
  });

  it("refuses a member who can only read it, setting on", async () => {
    state.membersCanDelete = true;
    state.canEdit = false;
    await expect(deleteDatabase(actor("MEMBER"), "db_1")).rejects.toBeInstanceOf(
      DatabaseInputError,
    );
    expect(db.databaseDefinition.deleteMany).not.toHaveBeenCalled();
  });

  it("never deletes a built-in database or a form's answers", async () => {
    state.def = { id: "db_p", name: "People", kind: "PEOPLE", archivedAt: null };
    await expect(deleteDatabase(actor("OWNER"), "db_p")).rejects.toThrow(
      "Built-in databases can't be deleted.",
    );
    state.def = { id: "db_1", name: "Answers", kind: "CUSTOM", archivedAt: null };
    state.forms = 1;
    await expect(deleteDatabase(actor("OWNER"), "db_1")).rejects.toThrow(/Delete the form/);
    expect(db.databaseDefinition.deleteMany).not.toHaveBeenCalled();
  });

  it("treats a database the viewer can't open, or another organization's, as missing", async () => {
    state.canView = false;
    await expect(deleteDatabase(actor("MEMBER"), "db_1")).rejects.toBeInstanceOf(NotFoundError);
    state.def = null;
    await expect(deleteDatabase(actor("OWNER"), "db_x")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("treats an archived database the viewer can't open as missing too", async () => {
    state.def = { id: "db_1", name: "Owners only", kind: "CUSTOM", archivedAt: new Date() };
    state.canView = false;
    await expect(deleteDatabase(actor("ADMIN"), "db_1")).rejects.toBeInstanceOf(NotFoundError);
    expect(db.databaseDefinition.deleteMany).not.toHaveBeenCalled();
  });

  it("only counts forms that aren't in the trash, and drops the database's links", async () => {
    await deleteDatabase(actor("ADMIN"), "db_1");
    expect(db.form.count).toHaveBeenCalledWith({
      where: { organizationId: "org_1", databaseId: "db_1", deletedAt: null },
    });
    expect(db.itemLink.deleteMany).toHaveBeenCalledTimes(1);
    const where = (
      db.itemLink.deleteMany.mock.calls[0] as unknown as [{ where: { OR: unknown[] } }]
    )[0].where;
    expect(where.OR).toContainEqual({ toKind: "record", toId: { in: ["rec_1"] } });
    expect(where.OR).toContainEqual({ fromKind: "database", fromId: { in: ["roster"] } });
  });

  it("says so when the database refused the delete", async () => {
    state.deleted = 0;
    await expect(deleteDatabase(actor("ADMIN"), "db_1")).rejects.toThrow(
      "That database could not be deleted.",
    );
  });
});
