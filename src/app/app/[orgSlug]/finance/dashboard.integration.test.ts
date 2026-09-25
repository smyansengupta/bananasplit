// @vitest-environment node
// Side-effecting import first: the runtime role URLs come from .env.
import "dotenv/config";

import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Integration test (spec 5.7 acceptance): seeds ~200 real transactions in a
 * throwaway org of the local database and asserts every dashboard figure,
 * read the way the page reads it (withOrgTx as a member, app_user under
 * RLS), matches an independent raw SQL aggregate (on the service path).
 * Skipped when the database is not reachable. The org and its member are
 * created on the service/auth paths and deleted in afterAll.
 */

const { requireUserMock } = vi.hoisted(() => ({ requireUserMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: requireUserMock }));

import { authDb, disconnectAll } from "@/server/db/clients";
import { withOrgTx, withSystemOrgTx, type SystemContext } from "@/server/db/context";

import { getDashboardData } from "./queries";

let dbAvailable = true;
try {
  await authDb.user.count();
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)("getDashboardData — matches independent raw SQL (spec 5.7)", () => {
  const orgId = `itest${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  let userId: string;
  let periodId: string;
  let categoryId: string;

  const dashboard = () => withOrgTx(orgId, ({ db }) => getDashboardData(db, orgId));
  const sql = <T>(fn: (ctx: SystemContext) => Promise<T>) => withSystemOrgTx(orgId, fn);

  beforeAll(async () => {
    const user = await authDb.user.create({
      data: {
        email: `dashboard-itest-${Date.now()}@example.edu`,
        name: "Dashboard Test",
        emailVerified: new Date(),
      },
      select: { id: true, email: true, name: true },
    });
    userId = user.id;
    requireUserMock.mockResolvedValue(user);

    await withSystemOrgTx(orgId, { userId }, async ({ db }) => {
      await db.organization.create({
        data: {
          id: orgId,
          name: "Dashboard Integration Test Org",
          slug: `dashboard-itest-${Date.now()}`,
        },
      });
      await db.membership.create({ data: { organizationId: orgId, userId, role: "OWNER" } });
    });

    await withSystemOrgTx(orgId, { userId }, async ({ db }) => {
      const period = await db.budgetPeriod.create({
        data: {
          organizationId: orgId,
          label: "Test Period",
          startsOn: new Date("2026-01-01"),
          endsOn: new Date("2026-12-31"),
          isActive: true,
        },
      });
      periodId = period.id;

      const category = await db.budgetCategory.create({
        data: {
          organizationId: orgId,
          budgetPeriodId: periodId,
          name: "Materials",
          allocatedCents: 500_000,
        },
      });
      categoryId = category.id;

      // Deterministic PRNG so a failing seed is reproducible.
      let seed = 12345;
      function random() {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
      }

      const rows = Array.from({ length: 200 }, (_, i) => {
        const direction = random() < 0.6 ? ("OUT" as const) : ("IN" as const);
        const kind = direction === "OUT" ? ("EXPENSE" as const) : ("OTHER_INCOME" as const);
        const amountCents = Math.floor(random() * 50_000) + 100;
        const month = Math.floor(random() * 6) + 1;
        const voided = random() < 0.1;
        return {
          organizationId: orgId,
          budgetPeriodId: periodId,
          categoryId: direction === "OUT" && random() < 0.7 ? categoryId : null,
          direction,
          kind,
          amountCents,
          description: `Test transaction ${i}`,
          occurredAt: new Date(2026, month - 1, 15),
          submittedById: userId,
          status: direction === "OUT" ? ("SUBMITTED" as const) : ("NOT_APPLICABLE" as const),
          voidedAt: voided ? new Date() : null,
          voidReason: voided ? "test void" : null,
        };
      });

      await db.transaction.createMany({ data: rows });
    });
  }, 30_000);

  afterAll(async () => {
    if (userId) {
      await withSystemOrgTx(orgId, ({ db }) =>
        db.organization.deleteMany({ where: { id: orgId } }),
      );
      await authDb.user.deleteMany({ where: { id: userId } });
    }
    await disconnectAll();
  });

  it("balance equals SUM(IN) - SUM(OUT) over non-voided transactions", async () => {
    const data = await dashboard();

    const [{ balance }] = await sql(
      ({ db }) =>
        db.$queryRaw<{ balance: bigint }[]>`
        SELECT COALESCE(
          SUM(CASE WHEN direction = 'IN' THEN "amountCents" ELSE -"amountCents" END), 0
        ) AS balance
        FROM "Transaction"
        WHERE "organizationId" = ${orgId} AND "budgetPeriodId" = ${periodId} AND "voidedAt" IS NULL
      `,
    );

    expect(data.balanceCents).toBe(Number(balance));
  });

  it("outstanding reimbursements equals SUM(amount) for SUBMITTED/APPROVED expenses", async () => {
    const data = await dashboard();

    const [{ total }] = await sql(
      ({ db }) =>
        db.$queryRaw<{ total: bigint | null }[]>`
        SELECT SUM("amountCents") AS total
        FROM "Transaction"
        WHERE "organizationId" = ${orgId}
          AND "budgetPeriodId" = ${periodId}
          AND kind = 'EXPENSE'
          AND status IN ('SUBMITTED', 'APPROVED')
          AND "voidedAt" IS NULL
      `,
    );

    expect(data.outstandingReimbursementsCents).toBe(Number(total ?? 0));
  });

  it("category spend equals SUM(OUT, non-voided) grouped by category", async () => {
    const data = await dashboard();

    const [{ spent }] = await sql(
      ({ db }) =>
        db.$queryRaw<{ spent: bigint | null }[]>`
        SELECT SUM("amountCents") AS spent
        FROM "Transaction"
        WHERE "organizationId" = ${orgId}
          AND "budgetPeriodId" = ${periodId}
          AND "categoryId" = ${categoryId}
          AND direction = 'OUT'
          AND "voidedAt" IS NULL
      `,
    );

    const found = data.categories.find((c) => c.id === categoryId);
    expect(found?.spentCents).toBe(Number(spent ?? 0));
  });

  it("total allocated equals SUM(allocatedCents) for the active period's categories", async () => {
    const data = await dashboard();

    const [{ total }] = await sql(
      ({ db }) =>
        db.$queryRaw<{ total: bigint }[]>`
        SELECT SUM("allocatedCents") AS total
        FROM "BudgetCategory"
        WHERE "budgetPeriodId" = ${periodId}
      `,
    );

    expect(data.totalAllocatedCents).toBe(Number(total));
  });

  it("burn-by-month totals sum back to the same overall in/out totals", async () => {
    const data = await dashboard();

    const burnInTotal = data.burnByMonth.reduce((sum, m) => sum + m.inCents, 0);
    const burnOutTotal = data.burnByMonth.reduce((sum, m) => sum + m.outCents, 0);

    const [{ inTotal, outTotal }] = await sql(
      ({ db }) =>
        db.$queryRaw<{ inTotal: bigint | null; outTotal: bigint | null }[]>`
        SELECT
          SUM(CASE WHEN direction = 'IN' THEN "amountCents" ELSE 0 END) AS "inTotal",
          SUM(CASE WHEN direction = 'OUT' THEN "amountCents" ELSE 0 END) AS "outTotal"
        FROM "Transaction"
        WHERE "organizationId" = ${orgId} AND "budgetPeriodId" = ${periodId} AND "voidedAt" IS NULL
      `,
    );

    expect(burnInTotal).toBe(Number(inTotal ?? 0));
    expect(burnOutTotal).toBe(Number(outTotal ?? 0));
  });

  it("a non-member cannot read the dashboard", async () => {
    requireUserMock.mockResolvedValueOnce({
      id: "not-a-member",
      email: "x@example.edu",
      name: null,
    });
    await expect(dashboard()).rejects.toThrow();
  });
});
