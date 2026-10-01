import { Role, TransactionKind } from "@/generated/prisma/client";
import { toDateValue } from "@/lib/finance/periods";
import { STARTING_BALANCE_DESCRIPTION, type FinanceSetupState } from "@/lib/finance/setup";
import type { TxClient } from "@/server/db/context";

/**
 * Reads where a club's finance setup stands (src/lib/finance/setup.ts says
 * what each step means). Runs as the caller under RLS, in their
 * transaction, one query at a time.
 */

/** The active period's live starting-balance row, if the club recorded one. */
export function findStartingBalance(db: TxClient, organizationId: string, budgetPeriodId: string) {
  return db.transaction.findFirst({
    where: {
      organizationId,
      budgetPeriodId,
      kind: TransactionKind.ADJUSTMENT,
      description: STARTING_BALANCE_DESCRIPTION,
      voidedAt: null,
    },
    orderBy: { occurredAt: "asc" },
  });
}

/** Who manages the club's money, by name (for the notice members and admins see). */
export async function loadFinancePeople(
  db: TxClient,
  organizationId: string,
): Promise<{ owners: string[]; treasurers: string[] }> {
  const rows = await db.membership.findMany({
    where: { organizationId, role: { in: [Role.OWNER, Role.TREASURER] } },
    select: { role: true, user: { select: { name: true } } },
    orderBy: { joinedAt: "asc" },
    take: 20,
  });
  const name = (r: (typeof rows)[number]) => r.user.name?.trim() || "a member without a name";
  return {
    owners: rows.filter((r) => r.role === Role.OWNER).map(name),
    treasurers: rows.filter((r) => r.role === Role.TREASURER).map(name),
  };
}

export async function loadSetupState(db: TxClient, organizationId: string, userId: string): Promise<FinanceSetupState> {
  const period = await db.budgetPeriod.findFirst({ where: { organizationId, isActive: true } });
  const treasurerCount = await db.membership.count({ where: { organizationId, role: Role.TREASURER } });
  const prefs = await db.memberPrefs.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: { financeWidgets: true },
  });
  const boardSaved = prefs?.financeWidgets != null;
  if (!period) {
    return {
      period: null,
      startingBalance: null,
      transactionCount: 0,
      categoryCount: 0,
      budgeted: false,
      treasurerCount,
      boardSaved,
    };
  }
  const starting = await findStartingBalance(db, organizationId, period.id);
  const transactionCount = await db.transaction.count({
    where: { organizationId, budgetPeriodId: period.id, voidedAt: null, ...(starting ? { id: { not: starting.id } } : {}) },
  });
  const categories = await db.budgetCategory.findMany({
    where: { organizationId, budgetPeriodId: period.id },
    select: { allocatedCents: true },
  });
  return {
    period: {
      id: period.id,
      label: period.label,
      startsOn: toDateValue(period.startsOn),
      endsOn: toDateValue(period.endsOn),
    },
    startingBalance: starting
      ? { cents: starting.direction === "IN" ? starting.amountCents : -starting.amountCents, asOf: toDateValue(starting.occurredAt) }
      : null,
    transactionCount,
    categoryCount: categories.length,
    budgeted: categories.some((c) => c.allocatedCents > 0),
    treasurerCount,
    boardSaved,
  };
}
