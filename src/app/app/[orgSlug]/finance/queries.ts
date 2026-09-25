import {
  TransactionDirection,
  TransactionKind,
  TransactionStatus,
} from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import type { TxClient } from "@/server/db/context";

/**
 * Finance reads. Every helper takes the caller's transaction client (ctx.db
 * from withOrgTx or withOrgAction) and runs as app_user under RLS: finance
 * rows of other orgs are invisible, and a Receipt is visible only to its
 * transaction's submitter or to OWNER/TREASURER. Helpers run their queries
 * one after another: a transaction has one connection.
 */

export function getActivePeriod(db: TxClient, organizationId: string) {
  return db.budgetPeriod.findFirst({ where: { organizationId, isActive: true } });
}

export function getOrgPeriods(db: TxClient, organizationId: string) {
  return db.budgetPeriod.findMany({
    where: { organizationId },
    orderBy: { startsOn: "desc" },
  });
}

export function getCategoriesForPeriod(
  db: TxClient,
  organizationId: string,
  budgetPeriodId: string,
) {
  return db.budgetCategory.findMany({
    where: { organizationId, budgetPeriodId },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * The categories of every period in `periods`, grouped in the periods' order
 * (then by sortOrder): one query instead of one per period.
 */
export async function getCategoriesForPeriods(
  db: TxClient,
  organizationId: string,
  periods: readonly { id: string }[],
) {
  if (periods.length === 0) return [];
  const rows = await db.budgetCategory.findMany({
    where: { organizationId, budgetPeriodId: { in: periods.map((p) => p.id) } },
    orderBy: { sortOrder: "asc" },
  });
  const rank = new Map(periods.map((p, i) => [p.id, i]));
  return rows.sort((a, b) => (rank.get(a.budgetPeriodId) ?? 0) - (rank.get(b.budgetPeriodId) ?? 0));
}

export function getOrgMembersForPicker(db: TxClient, organizationId: string) {
  return db.membership.findMany({
    where: { organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

export const transactionInclude = {
  category: { select: { id: true, name: true } },
  submittedBy: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  reconciledBy: { select: { id: true, name: true, email: true } },
  receipts: true,
} satisfies Prisma.TransactionInclude;

export type TransactionWithRelations = Prisma.TransactionGetPayload<{
  include: typeof transactionInclude;
}>;

export interface TransactionFilters {
  budgetPeriodId?: string;
  categoryId?: string;
  kind?: TransactionKind;
  status?: TransactionStatus;
  submittedById?: string;
  dateFrom?: string;
  dateTo?: string;
  reconciled?: "yes" | "no";
}

export function buildTransactionWhere(
  organizationId: string,
  filters: TransactionFilters,
): Prisma.TransactionWhereInput {
  return {
    organizationId,
    ...(filters.budgetPeriodId ? { budgetPeriodId: filters.budgetPeriodId } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.submittedById ? { submittedById: filters.submittedById } : {}),
    ...(filters.reconciled === "yes" ? { reconciledAt: { not: null } } : {}),
    ...(filters.reconciled === "no" ? { reconciledAt: null } : {}),
    ...(filters.dateFrom || filters.dateTo
      ? {
          occurredAt: {
            ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
            ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
          },
        }
      : {}),
  };
}

export function getTransactions(
  db: TxClient,
  organizationId: string,
  filters: TransactionFilters = {},
) {
  return db.transaction.findMany({
    where: buildTransactionWhere(organizationId, filters),
    include: transactionInclude,
    orderBy: { occurredAt: "desc" },
  });
}

export function getMyReimbursements(db: TxClient, organizationId: string, userId: string) {
  return db.transaction.findMany({
    where: { organizationId, kind: TransactionKind.EXPENSE, submittedById: userId },
    include: transactionInclude,
    orderBy: { occurredAt: "desc" },
  });
}

export function getSponsors(db: TxClient, organizationId: string) {
  return db.sponsor.findMany({ where: { organizationId }, orderBy: { name: "asc" } });
}

export function getSponsorships(db: TxClient, organizationId: string) {
  return db.sponsorship.findMany({
    where: { organizationId },
    include: {
      sponsor: true,
      owner: { select: { id: true, name: true, email: true } },
      budgetPeriod: { select: { id: true, label: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface DashboardData {
  period: { id: string; label: string } | null;
  balanceCents: number;
  totalAllocatedCents: number;
  categories: { id: string; name: string; allocatedCents: number; spentCents: number }[];
  outstandingReimbursementsCents: number;
  sponsorshipCommittedCents: number;
  sponsorshipReceivedCents: number;
  burnByMonth: { month: string; inCents: number; outCents: number }[];
  unreconciledOver60DaysCount: number;
}

export async function getDashboardData(
  db: TxClient,
  organizationId: string,
): Promise<DashboardData> {
  const period = await getActivePeriod(db, organizationId);
  if (!period) {
    return {
      period: null,
      balanceCents: 0,
      totalAllocatedCents: 0,
      categories: [],
      outstandingReimbursementsCents: 0,
      sponsorshipCommittedCents: 0,
      sponsorshipReceivedCents: 0,
      burnByMonth: [],
      unreconciledOver60DaysCount: 0,
    };
  }

  // Sequential: one transaction, one connection. The balance and the
  // outstanding total are summed from the period's non-voided transactions
  // fetched once, the same rows the separate aggregates used to read.
  const categories = await db.budgetCategory.findMany({
    where: { organizationId, budgetPeriodId: period.id },
    orderBy: { sortOrder: "asc" },
  });
  const sponsorships = await db.sponsorship.findMany({
    where: { organizationId, budgetPeriodId: period.id },
  });
  const allTransactions = await db.transaction.findMany({
    where: { organizationId, budgetPeriodId: period.id, voidedAt: null },
    select: {
      direction: true,
      kind: true,
      status: true,
      amountCents: true,
      occurredAt: true,
      reconciledAt: true,
      categoryId: true,
    },
  });

  let inTotal = 0;
  let outTotal = 0;
  let outstandingReimbursementsCents = 0;
  for (const t of allTransactions) {
    if (t.direction === TransactionDirection.IN) inTotal += t.amountCents;
    else outTotal += t.amountCents;
    if (
      t.kind === TransactionKind.EXPENSE &&
      (t.status === TransactionStatus.SUBMITTED || t.status === TransactionStatus.APPROVED)
    ) {
      outstandingReimbursementsCents += t.amountCents;
    }
  }

  // Single pass over the already-fetched period transactions instead of one
  // aggregate query per category (was O(categories) round-trips).
  const spentByCategory = new Map<string, number>();
  for (const t of allTransactions) {
    if (t.direction !== TransactionDirection.OUT || !t.categoryId) continue;
    spentByCategory.set(t.categoryId, (spentByCategory.get(t.categoryId) ?? 0) + t.amountCents);
  }
  const categorySpent = categories.map((c) => ({
    id: c.id,
    name: c.name,
    allocatedCents: c.allocatedCents,
    spentCents: spentByCategory.get(c.id) ?? 0,
  }));

  const burnMap = new Map<string, { inCents: number; outCents: number }>();
  for (const t of allTransactions) {
    const month = t.occurredAt.toISOString().slice(0, 7);
    const entry = burnMap.get(month) ?? { inCents: 0, outCents: 0 };
    if (t.direction === TransactionDirection.IN) entry.inCents += t.amountCents;
    else entry.outCents += t.amountCents;
    burnMap.set(month, entry);
  }
  const burnByMonth = [...burnMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const unreconciledOver60DaysCount = allTransactions.filter(
    (t) => !t.reconciledAt && t.occurredAt < sixtyDaysAgo,
  ).length;

  return {
    period: { id: period.id, label: period.label },
    balanceCents: inTotal - outTotal,
    totalAllocatedCents: categories.reduce((sum, c) => sum + c.allocatedCents, 0),
    categories: categorySpent,
    outstandingReimbursementsCents,
    sponsorshipCommittedCents: sponsorships
      .filter((s) => s.status === "COMMITTED" || s.status === "INVOICED")
      .reduce((sum, s) => sum + s.amountCents, 0),
    sponsorshipReceivedCents: sponsorships
      .filter((s) => s.status === "RECEIVED")
      .reduce((sum, s) => sum + s.amountCents, 0),
    burnByMonth,
    unreconciledOver60DaysCount,
  };
}

export async function getMoneyOwedToUser(
  db: TxClient,
  organizationId: string,
  userId: string,
): Promise<number> {
  const result = await db.transaction.aggregate({
    where: {
      organizationId,
      kind: TransactionKind.EXPENSE,
      submittedById: userId,
      status: { in: [TransactionStatus.SUBMITTED, TransactionStatus.APPROVED] },
      voidedAt: null,
    },
    _sum: { amountCents: true },
  });
  return result._sum.amountCents ?? 0;
}
