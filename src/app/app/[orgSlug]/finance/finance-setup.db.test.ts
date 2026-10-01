// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Finance that never dead-ends, against the real roles and policies: a
 * fresh club with no budget period records its first transaction (the
 * period is made on the spot), deletes and restores transactions, deletes a
 * category in use (its transactions become uncategorized) and a period
 * (only an empty one), and deletes a sponsorship. A throwaway org, deleted
 * in afterAll; skipped without the database.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx } from "@/server/db/context";

import { createBudgetPeriod, deleteBudgetPeriod, deleteCategory, startBudget } from "./periods-actions";
import { getTransactions } from "./queries";
import { createSponsor, createSponsorship, deleteSponsor, deleteSponsorship } from "./sponsorships-actions";
import { createTransaction, deleteTransaction, restoreTransaction, submitExpense } from "./transactions-actions";

interface Person {
  id: string;
  email: string;
  name: string | null;
}

const stamp = Date.now();
const orgId = `fis${randomUUID().replace(/-/g, "").slice(0, 20)}`;
const people: Record<"treasurer" | "member" | "member2", Person> = {} as never;
let reachable = true;
const as = (p: Person) => requireUserMock.mockResolvedValue(p);

const expense = (description: string, amountCents: number) => ({
  kind: "EXPENSE",
  direction: "OUT",
  amountCents,
  description,
  occurredAt: new Date().toISOString(),
});

beforeAll(async () => {
  try {
    for (const [key, role] of [
      ["treasurer", "OWNER"],
      ["member", "MEMBER"],
      ["member2", "MEMBER"],
    ] as const) {
      people[key] = await authDb.user.create({
        data: { email: `fis-${key}-${stamp}@example.edu`, name: `Fis ${key}`, emailVerified: new Date() },
        select: { id: true, email: true, name: true },
      });
      await withSystemOrgTx(orgId, { userId: people[key].id }, async ({ db }) => {
        if (key === "treasurer") {
          await db.organization.create({ data: { id: orgId, name: "Finance setup itest", slug: `fis-itest-${stamp}` } });
        }
        await db.membership.create({ data: { organizationId: orgId, userId: people[key].id, role } });
      });
    }
  } catch (error) {
    console.warn("[finance-setup.db.test] skipped:", error instanceof Error ? error.message : error);
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

describe("finance with nothing set up", () => {
  it("a member can't file a request before the budget exists; the treasurer's first transaction creates it", async () => {
    if (!reachable) return;
    as(people.member);
    const early = await createTransaction(orgId, expense("Pizza", 4_200));
    expect(early.error).toMatch(/treasurer hasn't set up the budget/);

    as(people.treasurer);
    const first = await createTransaction(orgId, {
      kind: "OTHER_INCOME",
      direction: "IN",
      amountCents: 50_000,
      description: "Dues",
      occurredAt: new Date().toISOString(),
      budgetPeriodId: "",
    });
    expect(first.error).toBeUndefined();
    const periods = await withOrgTx(orgId, ({ db }) => db.budgetPeriod.findMany({ where: { organizationId: orgId } }));
    expect(periods).toHaveLength(1);
    expect(periods[0].isActive).toBe(true);
    expect(periods[0].label).toMatch(/^\d{4}–\d{2}$/);
    const starter = await withOrgTx(orgId, ({ db }) =>
      db.budgetCategory.count({ where: { organizationId: orgId, budgetPeriodId: periods[0].id } }),
    );
    expect(starter).toBeGreaterThan(0);
    // One click does nothing more once a period exists.
    expect(await startBudget(orgId)).toEqual({ periodId: periods[0].id });

    // Now members can file requests into it.
    as(people.member);
    expect((await createTransaction(orgId, expense("Pizza", 4_200))).error).toBeUndefined();
  });

  it("delete hides a transaction everywhere and undo brings it back; members delete only their own open requests", async () => {
    if (!reachable) return;
    as(people.member);
    const mine = await createTransaction(orgId, expense("Poster printing", 1_500));
    expect(mine.error).toBeUndefined();
    await submitExpense(orgId, mine.transactionId!);

    as(people.member2);
    expect((await deleteTransaction(orgId, mine.transactionId!)).error).toMatch(/Only a treasurer/);

    as(people.member);
    expect(await deleteTransaction(orgId, mine.transactionId!)).toEqual({ transactionId: mine.transactionId });
    as(people.treasurer);
    const listed = async (deleted?: "show") =>
      (await withOrgTx(orgId, ({ db }) => getTransactions(db, orgId, { deleted }))).map((t) => t.description);
    expect(await listed()).not.toContain("Poster printing");
    expect(await listed("show")).toContain("Poster printing");

    expect((await restoreTransaction(orgId, mine.transactionId!)).error).toBeUndefined();
    expect(await listed()).toContain("Poster printing");

    // A treasurer deletes anything that isn't locked.
    const dues = (await listed()).length;
    const income = await withOrgTx(orgId, ({ db }) =>
      db.transaction.findFirstOrThrow({ where: { organizationId: orgId, description: "Dues" } }),
    );
    expect((await deleteTransaction(orgId, income.id)).error).toBeUndefined();
    expect((await listed()).length).toBe(dues - 1);
    // The audit log has both the delete and the restore.
    const actions = await withOrgTx(orgId, ({ db }) =>
      db.financeAuditLog.findMany({ where: { transactionId: mine.transactionId }, select: { action: true } }),
    );
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["VOID", "RESTORE"]));
  });

  it("deleting a category in use leaves its transactions uncategorized; only an empty period can be deleted", async () => {
    if (!reachable) return;
    as(people.treasurer);
    const period = await withOrgTx(orgId, ({ db }) =>
      db.budgetPeriod.findFirstOrThrow({ where: { organizationId: orgId, isActive: true } }),
    );
    const categories = await withOrgTx(orgId, ({ db }) =>
      db.budgetCategory.findMany({ where: { organizationId: orgId, budgetPeriodId: period.id } }),
    );
    const food = categories.find((c) => c.name === "Food") ?? categories[0];
    const filed = await createTransaction(orgId, { ...expense("Snacks", 900), categoryId: food.id });
    expect(filed.error).toBeUndefined();

    expect(await deleteCategory(orgId, food.id)).toEqual({ moved: 1 });
    const after = await withOrgTx(orgId, ({ db }) =>
      db.transaction.findUniqueOrThrow({ where: { id: filed.transactionId! } }),
    );
    expect(after.categoryId).toBeNull();

    expect((await deleteBudgetPeriod(orgId, period.id)).error).toMatch(/stays for the records/);
    const spare = await createBudgetPeriod(orgId, { label: "Spare", startsOn: "2030-01-01", endsOn: "2030-12-31" });
    expect(spare.error).toBeUndefined();
    expect(await deleteBudgetPeriod(orgId, spare.periodId!)).toEqual({});
    // The period it replaced is active again.
    const active = await withOrgTx(orgId, ({ db }) =>
      db.budgetPeriod.findFirst({ where: { organizationId: orgId, isActive: true }, select: { id: true } }),
    );
    expect(active?.id).toBe(period.id);
  });

  it("sponsorships and sponsors can be deleted (a sponsor only once it has none)", async () => {
    if (!reachable) return;
    as(people.treasurer);
    const sponsor = await createSponsor(orgId, { name: `Acme ${stamp}` });
    expect(sponsor.error).toBeUndefined();
    const period = await withOrgTx(orgId, ({ db }) =>
      db.budgetPeriod.findFirstOrThrow({ where: { organizationId: orgId, isActive: true } }),
    );
    const deal = await createSponsorship(orgId, {
      sponsorId: sponsor.sponsorId,
      budgetPeriodId: period.id,
      amountCents: 100_000,
      ownerId: people.treasurer.id,
    });
    expect(deal.error).toBeUndefined();
    expect((await deleteSponsor(orgId, sponsor.sponsorId!)).error).toMatch(/still has 1 sponsorship/);
    expect(await deleteSponsorship(orgId, deal.sponsorshipId!)).toEqual({});
    expect(await deleteSponsor(orgId, sponsor.sponsorId!)).toEqual({});
  });
});
