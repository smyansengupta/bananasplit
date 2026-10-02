// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Finance setup and imports against the real roles and policies: past rows
 * land in new budget years with their categories (one finance audit row
 * each, tagged with the batch), duplicates are spotted, an import is undone
 * (reconciled rows too), a budget sheet updates categories by name, the
 * starting balance is set, changed and removed, and budget lines are saved
 * as a list. Members can do none of it. A throwaway org, deleted in
 * afterAll; skipped without the database.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";
import { loadSetupState } from "@/server/finance/setup";

import { checkImportDuplicates, importFinanceBudget, importFinanceRecords, undoFinanceImport } from "./import-actions";
import { getDashboardData, getMyReimbursements } from "./queries";
import { saveBudgetLines, setStartingBalance } from "./setup-actions";

interface Person {
  id: string;
  email: string;
  name: string | null;
}

const stamp = Date.now();
const orgId = `fim${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const people: Record<"treasurer" | "member", Person> = {} as never;
let reachable = true;
const as = (p: Person) => requireUserMock.mockResolvedValue(p);
const batch = () => randomUUID().replace(/-/g, "").slice(0, 24);

const thisYear = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
const day = (y: number, md: string) => `${y}-${md}`;

const record = (date: string, description: string, amountCents: number, direction: "IN" | "OUT", category: string | null = null) => ({
  date,
  description,
  amountCents,
  direction,
  kind: direction === "OUT" ? "EXPENSE" : "OTHER_INCOME",
  category,
  counterparty: null,
  paymentMethod: null,
});

beforeAll(async () => {
  try {
    for (const [key, role] of [
      ["treasurer", "OWNER"],
      ["member", "MEMBER"],
    ] as const) {
      people[key] = await authDb.user.create({
        data: { email: `fim-${key}-${stamp}@example.edu`, name: `Fim ${key}`, emailVerified: new Date() },
        select: { id: true, email: true, name: true },
      });
      await withSystemOrgTx(orgId, { userId: people[key].id }, async ({ db }) => {
        if (key === "treasurer") {
          await db.organization.create({ data: { id: orgId, name: "Finance import itest", slug: `fim-itest-${stamp}` } });
        }
        await db.membership.create({ data: { organizationId: orgId, userId: people[key].id, role } });
      });
    }
  } catch (error) {
    console.warn("[finance-import.db.test] skipped:", error instanceof Error ? error.message : error);
    reachable = false;
  }
}, 30_000);

afterAll(async () => {
  if (reachable) {
    await withSystemOrgTx(orgId, ({ db }) => db.organization.deleteMany({ where: { id: orgId } }));
  }
  const ids = Object.values(people).map((p) => p.id).filter(Boolean);
  if (ids.length) await authDb.user.deleteMany({ where: { id: { in: ids } } });
  await disconnectAll();
});

describe("finance setup and imports (db)", () => {
  const first = batch();

  it("imports past rows into a new budget year, with categories and one audit row each", async () => {
    if (!reachable) return;
    as(people.treasurer);
    const res = await importFinanceRecords(orgId, {
      batch: first,
      source: "ledger-2025.csv",
      records: [
        record(day(thisYear - 1, "09-05"), "Pizza for kickoff", 8450, "OUT", "Food"),
        record(day(thisYear - 1, "09-08"), "Member dues", 24000, "IN", "Dues"),
        record(day(thisYear, "09-15"), "Posters", 3520, "OUT", "Marketing"),
      ],
      createPeriods: true,
      createCategories: true,
      reconciled: false,
    });
    expect(res.error).toBeUndefined();
    expect(res.outcome?.created).toBe(3);
    const label = `${thisYear - 1}–${String(thisYear % 100).padStart(2, "0")}`;
    expect(res.outcome?.periods).toEqual(
      expect.arrayContaining([
        { label, created: true, count: 2 },
        expect.objectContaining({ created: false, count: 1 }),
      ]),
    );
    expect(res.outcome?.categoriesCreated).toEqual(expect.arrayContaining(["Food", "Dues"]));

    await withSystemOrgTx(orgId, async ({ db }) => {
      const past = await db.budgetPeriod.findFirstOrThrow({ where: { organizationId: orgId, label } });
      expect(past.isActive).toBe(false);
      const rows = await db.transaction.findMany({ where: { organizationId: orgId }, include: { category: true } });
      expect(rows.every((r) => r.status === "NOT_APPLICABLE" && r.submittedById === people.treasurer.id)).toBe(true);
      expect(rows.find((r) => r.description === "Posters")?.category?.name).toBe("Marketing");
      const audit = await db.financeAuditLog.findMany({ where: { organizationId: orgId, action: "IMPORT" } });
      expect(audit).toHaveLength(3);
      expect(audit.every((a) => (a.diffJson as { batch?: string }).batch === first)).toBe(true);
      expect(audit.every((a) => a.actorId === people.treasurer.id)).toBe(true);
    });

    // Imported expenses are nobody's reimbursement request.
    const mine = await withOrgTx(orgId, ({ db }) => getMyReimbursements(db, orgId, people.treasurer.id));
    expect(mine).toHaveLength(0);
  });

  it("spots rows already in the books, and undoes an import", async () => {
    if (!reachable) return;
    as(people.treasurer);
    const dup = await checkImportDuplicates(orgId, [
      { date: day(thisYear - 1, "09-05"), amountCents: 8450, direction: "OUT" },
      { date: day(thisYear - 1, "09-05"), amountCents: 8450, direction: "IN" },
      { date: day(thisYear - 1, "09-06"), amountCents: 8450, direction: "OUT" },
    ]);
    expect(dup.duplicates).toEqual([`${day(thisYear - 1, "09-05")}|8450|OUT`]);

    const undone = await undoFinanceImport(orgId, first);
    expect(undone).toEqual({ removed: 3 });
    const live = await withSystemOrgTx(orgId, ({ db }) => db.transaction.count({ where: { organizationId: orgId, voidedAt: null } }));
    expect(live).toBe(0);
    expect((await checkImportDuplicates(orgId, [{ date: day(thisYear - 1, "09-05"), amountCents: 8450, direction: "OUT" }])).duplicates).toEqual([]);
    expect(await undoFinanceImport(orgId, first)).toEqual({ removed: 0 });
  });

  it("leaves out rows no period covers when asked not to add periods, and undoes reconciled rows", async () => {
    if (!reachable) return;
    as(people.treasurer);
    const second = batch();
    const res = await importFinanceRecords(orgId, {
      batch: second,
      source: "bank.csv",
      records: [record(day(thisYear - 5, "10-01"), "Ancient", 100, "OUT"), record(day(thisYear, "10-01"), "Recent", 200, "IN")],
      createPeriods: false,
      createCategories: false,
      reconciled: true,
    });
    expect(res.outcome?.created).toBe(1);
    expect(res.outcome?.skipped).toEqual([{ index: 0, reason: `No budget period covers ${day(thisYear - 5, "10-01")}.` }]);
    const row = await withSystemOrgTx(orgId, ({ db }) =>
      db.transaction.findFirstOrThrow({ where: { organizationId: orgId, description: "Recent" } }),
    );
    expect(row.reconciledById).toBe(people.treasurer.id);
    expect(row.statementRef).toBe("Imported from bank.csv");
    expect(await undoFinanceImport(orgId, second)).toEqual({ removed: 1 });
  });

  it("puts a budget sheet's lines on the period, updating categories by name", async () => {
    if (!reachable) return;
    as(people.treasurer);
    const res = await importFinanceBudget(orgId, {
      periodId: null,
      lines: [
        { name: "food", allocatedCents: 120000 },
        { name: "Hackathon", allocatedCents: 50000 },
      ],
    });
    expect(res).toMatchObject({ updated: 1, created: 1 });
    const cats = await withSystemOrgTx(orgId, ({ db }) =>
      db.budgetCategory.findMany({ where: { organizationId: orgId, budgetPeriod: { isActive: true } } }),
    );
    expect(cats.find((c) => c.name === "Food")?.allocatedCents).toBe(120000);
    expect(cats.find((c) => c.name === "Hackathon")?.allocatedCents).toBe(50000);
  });

  it("sets, changes and removes the starting balance; the dashboard counts it", async () => {
    if (!reachable) return;
    as(people.treasurer);
    const asOf = day(thisYear, "08-01");
    const set = await setStartingBalance(orgId, { cents: 150000, asOf });
    expect(set.error).toBeUndefined();
    let state = await withOrgTx(orgId, ({ db }) => loadSetupState(db, orgId, people.treasurer.id));
    expect(state.startingBalance).toEqual({ cents: 150000, asOf });
    const dashboard = await withOrgTx(orgId, ({ db }) => getDashboardData(db, orgId));
    expect(dashboard.balanceCents).toBe(150000);
    expect(dashboard.unreconciledOver60DaysCount).toBe(0);
    expect(dashboard.incomeByKind).toEqual([{ kind: "ADJUSTMENT", cents: 150000 }]);

    await setStartingBalance(orgId, { cents: -5000, asOf });
    state = await withOrgTx(orgId, ({ db }) => loadSetupState(db, orgId, people.treasurer.id));
    expect(state.startingBalance?.cents).toBe(-5000);

    expect(await setStartingBalance(orgId, { cents: 0, asOf })).toEqual({ transactionId: null });
    state = await withOrgTx(orgId, ({ db }) => loadSetupState(db, orgId, people.treasurer.id));
    expect(state.startingBalance).toBeNull();
    expect(state.budgeted).toBe(true);
  });

  it("saves the budget step's list: renames, amounts, removals, and keeps lines in use", async () => {
    if (!reachable) return;
    as(people.treasurer);
    const state = await withOrgTx(orgId, ({ db }) => loadSetupState(db, orgId, people.treasurer.id));
    const periodId = state.period!.id;
    const cats = await withSystemOrgTx(orgId, ({ db }) =>
      db.budgetCategory.findMany({ where: { budgetPeriodId: periodId }, orderBy: { sortOrder: "asc" } }),
    );
    const food = cats.find((c) => c.name === "Food")!;
    const marketing = cats.find((c) => c.name === "Marketing")!;
    // Marketing has a (deleted) imported transaction filed under it, so it stays.
    const res = await saveBudgetLines(orgId, periodId, [
      { id: food.id, name: "Food & drinks", allocatedCents: 90000 },
      { id: null, name: "Speakers", allocatedCents: 30000 },
    ]);
    expect(res).toEqual({ kept: 1 });
    const after = await withSystemOrgTx(orgId, ({ db }) =>
      db.budgetCategory.findMany({ where: { budgetPeriodId: periodId }, orderBy: { sortOrder: "asc" } }),
    );
    expect(after.map((c) => c.name).sort()).toEqual(["Food & drinks", "Marketing", "Speakers"].sort());
    expect(after.find((c) => c.id === marketing.id)).toBeTruthy();
    expect(after.find((c) => c.name === "Food & drinks")?.allocatedCents).toBe(90000);

    expect((await saveBudgetLines(orgId, periodId, [{ id: null, name: "A", allocatedCents: 1 }, { id: null, name: "a", allocatedCents: 2 }])).error).toMatch(/same name/);
  });

  it("lets members do none of it", async () => {
    if (!reachable) return;
    as(people.member);
    const res = await importFinanceRecords(orgId, {
      batch: batch(),
      source: "x.csv",
      records: [record(day(thisYear, "09-01"), "Sneaky", 100, "IN")],
      createPeriods: true,
      createCategories: true,
      reconciled: false,
    });
    expect(res.error).toMatch(/owners and treasurers/);
    expect((await setStartingBalance(orgId, { cents: 100, asOf: day(thisYear, "09-01") })).error).toMatch(/owners and treasurers/);
    expect((await importFinanceBudget(orgId, { periodId: null, lines: [{ name: "X", allocatedCents: 1 }] })).error).toMatch(
      /owners and treasurers/,
    );
    expect((await checkImportDuplicates(orgId, [])).error).toMatch(/owners and treasurers/);
    expect((await undoFinanceImport(orgId, "abcdefgh12345678")).error).toMatch(/owners and treasurers/);
  });
});
