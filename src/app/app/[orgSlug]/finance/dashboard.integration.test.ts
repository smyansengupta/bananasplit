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

import type { Prisma } from "@/generated/prisma/client";
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

  // The seed's spending runs January to June; "today" is July 1, so the
  // 90-day burn window covers April to June.
  const NOW = new Date("2026-07-01T00:00:00Z");
  const DAY_MS = 24 * 60 * 60 * 1000;

  const dashboard = () => withOrgTx(orgId, ({ db }) => getDashboardData(db, orgId, NOW));
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

      const rows: Prisma.TransactionCreateManyInput[] = Array.from({ length: 200 }, (_, i) => {
        const direction = random() < 0.6 ? ("OUT" as const) : ("IN" as const);
        const kind = direction === "OUT" ? ("EXPENSE" as const) : ("OTHER_INCOME" as const);
        const amountCents = Math.floor(random() * 50_000) + 100;
        const month = Math.floor(random() * 6) + 1;
        const voided = random() < 0.1;
        const draft = random() < 0.25;
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
          status:
            direction === "OUT"
              ? draft
                ? ("DRAFT" as const)
                : ("SUBMITTED" as const)
              : ("NOT_APPLICABLE" as const),
          voidedAt: voided ? new Date() : null,
          voidReason: voided ? "test void" : null,
        };
      });
      // An allocation large enough that the balance is positive and the
      // run-out date is a real projection rather than "today".
      rows.push({
        organizationId: orgId,
        budgetPeriodId: periodId,
        categoryId: null,
        direction: "IN",
        kind: "ALLOCATION",
        amountCents: 5_000_000,
        description: "Test allocation",
        occurredAt: new Date(2026, 0, 2),
        submittedById: userId,
        status: "NOT_APPLICABLE",
        voidedAt: null,
        voidReason: null,
      });

      await db.transaction.createMany({ data: rows });

      // Three meetings held and one still scheduled. The board meeting, the
      // deleted event and the one before the period never count.
      const event = (
        title: string,
        startsAt: string,
        extra: Partial<Prisma.EventCreateManyInput>,
      ): Prisma.EventCreateManyInput => ({
        organizationId: orgId,
        title,
        startsAt: new Date(startsAt),
        endsAt: new Date(new Date(startsAt).getTime() + 2 * 60 * 60 * 1000),
        createdById: userId,
        ...extra,
      });
      await db.event.createMany({
        data: [
          event("Workshop", "2026-02-10T23:00:00Z", { kind: "WORKSHOP" }),
          event("Social", "2026-03-10T23:00:00Z", { kind: "SOCIAL" }),
          event("Info session", "2026-04-10T23:00:00Z", { kind: "INFO_SESSION" }),
          event("Board meeting", "2026-03-01T23:00:00Z", { kind: "BOARD_MEETING" }),
          event("Cancelled", "2026-05-01T23:00:00Z", { kind: "WORKSHOP", deletedAt: new Date() }),
          event("Last year", "2025-12-01T23:00:00Z", { kind: "WORKSHOP" }),
          event("Next workshop", "2026-09-10T23:00:00Z", { kind: "WORKSHOP" }),
        ],
      });
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

  it("balance equals SUM(IN) - SUM(OUT) over non-voided transactions, drafts and rejections left out", async () => {
    const data = await dashboard();

    const [{ balance, drafts }] = await sql(
      ({ db }) =>
        db.$queryRaw<{ balance: bigint; drafts: bigint }[]>`
        SELECT
          COALESCE(SUM(
            CASE WHEN status IN ('DRAFT', 'REJECTED') THEN 0
                 WHEN direction = 'IN' THEN "amountCents" ELSE -"amountCents" END
          ), 0) AS balance,
          COUNT(*) FILTER (WHERE status = 'DRAFT') AS drafts
        FROM "Transaction"
        WHERE "organizationId" = ${orgId} AND "budgetPeriodId" = ${periodId} AND "voidedAt" IS NULL
      `,
    );

    // The seed has live drafts, so leaving them out really changes the figure.
    expect(Number(drafts)).toBeGreaterThan(0);
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

  it("category spend equals SUM(OUT, non-voided, not draft or rejected) grouped by category", async () => {
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
          AND status NOT IN ('DRAFT', 'REJECTED')
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
        WHERE "organizationId" = ${orgId}
          AND "budgetPeriodId" = ${periodId}
          AND status NOT IN ('DRAFT', 'REJECTED')
          AND "voidedAt" IS NULL
      `,
    );

    expect(burnInTotal).toBe(Number(inTotal ?? 0));
    expect(burnOutTotal).toBe(Number(outTotal ?? 0));
  });

  it("average spend per meeting divides the spending by club events held, board meetings left out", async () => {
    const data = await dashboard();

    const [{ spent }] = await sql(
      ({ db }) =>
        db.$queryRaw<{ spent: bigint | null }[]>`
        SELECT SUM("amountCents") AS spent
        FROM "Transaction"
        WHERE "organizationId" = ${orgId}
          AND "budgetPeriodId" = ${periodId}
          AND direction = 'OUT'
          AND status NOT IN ('DRAFT', 'REJECTED')
          AND "voidedAt" IS NULL
      `,
    );

    expect(data.runway?.spentCents).toBe(Number(spent ?? 0));
    expect(data.runway?.meetingsHeld).toBe(3);
    expect(data.runway?.meetingsScheduled).toBe(1);
    expect(data.runway?.avgSpendPerMeetingCents).toBe(Math.round(Number(spent ?? 0) / 3));
  });

  it("the run-out date runs the last 90 days of spending forward from the balance", async () => {
    const data = await dashboard();

    const [{ windowSpent }] = await sql(
      ({ db }) =>
        db.$queryRaw<{ windowSpent: bigint | null }[]>`
        SELECT SUM("amountCents") AS "windowSpent"
        FROM "Transaction"
        WHERE "organizationId" = ${orgId}
          AND "budgetPeriodId" = ${periodId}
          AND direction = 'OUT'
          AND status NOT IN ('DRAFT', 'REJECTED')
          AND "voidedAt" IS NULL
          AND "occurredAt" > ${new Date(NOW.getTime() - 90 * DAY_MS)}
          AND "occurredAt" <= ${NOW}
      `,
    );
    const dailyBurn = Number(windowSpent ?? 0) / 90;
    expect(dailyBurn).toBeGreaterThan(0);
    expect(data.balanceCents).toBeGreaterThan(0);

    const expected = NOW.getTime() + (data.balanceCents / dailyBurn) * DAY_MS;
    expect(Math.abs((data.runway?.runOutDate?.getTime() ?? 0) - expected)).toBeLessThan(1000);
    expect(data.runway?.status).toBe(expected < Date.UTC(2027, 0, 1) ? "short" : "lasts");
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
