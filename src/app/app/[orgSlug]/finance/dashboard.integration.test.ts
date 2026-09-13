// Side-effecting import: must run before `@/lib/prisma` below so
// DATABASE_URL is in process.env before that module constructs its adapter.
// A plain `import { config } from "dotenv"; config();` doesn't work here —
// all import declarations in a module are evaluated before any of the
// module's own statements, including ones textually above them.
import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

import { getDashboardData } from "./queries";

/**
 * Integration test (spec 5.7 acceptance): seeds ~200 real transactions in
 * the dev Postgres database and asserts every dashboard figure matches an
 * independent raw SQL aggregate. Unlike every other test in this project,
 * this one talks to a real database rather than a mocked Prisma client —
 * it needs the docker-compose Postgres from `pnpm db:migrate`/`db:seed`
 * running locally (DATABASE_URL in .env) and the whole suite is skipped if
 * that connection isn't reachable at module load time.
 */
let dbAvailable = true;
try {
  await prisma.$queryRaw`SELECT 1`;
} catch {
  dbAvailable = false;
}

describe.skipIf(!dbAvailable)("getDashboardData — matches independent raw SQL (spec 5.7)", () => {
  let orgId: string;
  let periodId: string;
  let categoryId: string;

  beforeAll(async () => {
    const user = await prisma.user.findFirstOrThrow({ select: { id: true } });

    const org = await prisma.organization.create({
      data: { name: "Dashboard Integration Test Org", slug: `dashboard-itest-${Date.now()}` },
    });
    orgId = org.id;

    const period = await prisma.budgetPeriod.create({
      data: {
        organizationId: orgId,
        label: "Test Period",
        startsOn: new Date("2026-01-01"),
        endsOn: new Date("2026-12-31"),
        isActive: true,
      },
    });
    periodId = period.id;

    const category = await prisma.budgetCategory.create({
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
        submittedById: user.id,
        status: direction === "OUT" ? ("SUBMITTED" as const) : ("NOT_APPLICABLE" as const),
        voidedAt: voided ? new Date() : null,
        voidReason: voided ? "test void" : null,
      };
    });

    await prisma.transaction.createMany({ data: rows });
  }, 30_000);

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } });
  });

  it("balance equals SUM(IN) - SUM(OUT) over non-voided transactions", async () => {
    const dashboard = await getDashboardData(orgId);

    const [{ balance }] = await prisma.$queryRaw<{ balance: bigint }[]>`
      SELECT COALESCE(
        SUM(CASE WHEN direction = 'IN' THEN "amountCents" ELSE -"amountCents" END), 0
      ) AS balance
      FROM "Transaction"
      WHERE "organizationId" = ${orgId} AND "budgetPeriodId" = ${periodId} AND "voidedAt" IS NULL
    `;

    expect(dashboard.balanceCents).toBe(Number(balance));
  });

  it("outstanding reimbursements equals SUM(amount) for SUBMITTED/APPROVED expenses", async () => {
    const dashboard = await getDashboardData(orgId);

    const [{ total }] = await prisma.$queryRaw<{ total: bigint | null }[]>`
      SELECT SUM("amountCents") AS total
      FROM "Transaction"
      WHERE "organizationId" = ${orgId}
        AND "budgetPeriodId" = ${periodId}
        AND kind = 'EXPENSE'
        AND status IN ('SUBMITTED', 'APPROVED')
        AND "voidedAt" IS NULL
    `;

    expect(dashboard.outstandingReimbursementsCents).toBe(Number(total ?? 0));
  });

  it("category spend equals SUM(OUT, non-voided) grouped by category", async () => {
    const dashboard = await getDashboardData(orgId);

    const [{ spent }] = await prisma.$queryRaw<{ spent: bigint | null }[]>`
      SELECT SUM("amountCents") AS spent
      FROM "Transaction"
      WHERE "organizationId" = ${orgId}
        AND "budgetPeriodId" = ${periodId}
        AND "categoryId" = ${categoryId}
        AND direction = 'OUT'
        AND "voidedAt" IS NULL
    `;

    const found = dashboard.categories.find((c) => c.id === categoryId);
    expect(found?.spentCents).toBe(Number(spent ?? 0));
  });

  it("total allocated equals SUM(allocatedCents) for the active period's categories", async () => {
    const dashboard = await getDashboardData(orgId);

    const [{ total }] = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT SUM("allocatedCents") AS total
      FROM "BudgetCategory"
      WHERE "budgetPeriodId" = ${periodId}
    `;

    expect(dashboard.totalAllocatedCents).toBe(Number(total));
  });

  it("burn-by-month totals sum back to the same overall in/out totals", async () => {
    const dashboard = await getDashboardData(orgId);

    const burnInTotal = dashboard.burnByMonth.reduce((sum, m) => sum + m.inCents, 0);
    const burnOutTotal = dashboard.burnByMonth.reduce((sum, m) => sum + m.outCents, 0);

    const [{ inTotal, outTotal }] = await prisma.$queryRaw<
      { inTotal: bigint | null; outTotal: bigint | null }[]
    >`
      SELECT
        SUM(CASE WHEN direction = 'IN' THEN "amountCents" ELSE 0 END) AS "inTotal",
        SUM(CASE WHEN direction = 'OUT' THEN "amountCents" ELSE 0 END) AS "outTotal"
      FROM "Transaction"
      WHERE "organizationId" = ${orgId} AND "budgetPeriodId" = ${periodId} AND "voidedAt" IS NULL
    `;

    expect(burnInTotal).toBe(Number(inTotal ?? 0));
    expect(burnOutTotal).toBe(Number(outTotal ?? 0));
  });
});
