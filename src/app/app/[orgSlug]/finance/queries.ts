import {
  EventKind,
  TransactionDirection,
  TransactionKind,
  TransactionStatus,
} from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { DELETED_TRANSACTION_REASON } from "@/lib/finance/deleted";
import { computeRunway, countsTowardBalance, type Runway } from "@/lib/finance/stats";
import type { TxClient } from "@/server/db/context";

/**
 * Finance reads. Every helper takes the caller's transaction client (ctx.db
 * from withOrgTx or withOrgAction) and runs as app_user under RLS: finance
 * rows of other orgs are invisible, and a Receipt is visible only to its
 * transaction's submitter or to OWNER/TREASURER. Helpers run their queries
 * one after another: a transaction has one connection.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

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
  /** Deleted transactions (voided as "Deleted") are hidden unless "show". */
  deleted?: "show";
}

/** Everything but deleted transactions (a NULL voidReason must count as kept). */
const NOT_DELETED: Prisma.TransactionWhereInput = {
  OR: [{ voidReason: null }, { voidReason: { not: DELETED_TRANSACTION_REASON } }],
};

/**
 * The end of a date filter. A date-only end ("2026-09-21", the filter's date
 * input) includes that whole day, whatever time a transaction carries
 * (imports and the seed store times); anything else is taken as an instant.
 */
function dateToBound(dateTo: string): Prisma.DateTimeFilter {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    const next = new Date(`${dateTo}T00:00:00.000Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return { lt: next };
  }
  return { lte: new Date(dateTo) };
}

export function buildTransactionWhere(
  organizationId: string,
  filters: TransactionFilters,
): Prisma.TransactionWhereInput {
  return {
    organizationId,
    ...(filters.deleted === "show" ? {} : NOT_DELETED),
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
            ...(filters.dateTo ? dateToBound(filters.dateTo) : {}),
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

/**
 * The member's own expense requests. An expense nobody is owed (NOT_APPLICABLE:
 * paid with the club's money, or imported from past records) isn't one.
 */
export function getMyReimbursements(db: TxClient, organizationId: string, userId: string) {
  return db.transaction.findMany({
    where: {
      organizationId,
      kind: TransactionKind.EXPENSE,
      submittedById: userId,
      status: { not: TransactionStatus.NOT_APPLICABLE },
      ...NOT_DELETED,
    },
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
  period: { id: string; label: string; startsOn: Date; endsOn: Date } | null;
  balanceCents: number;
  totalAllocatedCents: number;
  categories: { id: string; name: string; allocatedCents: number; spentCents: number }[];
  outstandingReimbursementsCents: number;
  /** Cash sponsorships, committed or invoiced and still to come. */
  sponsorshipCommittedCents: number;
  /** Cash sponsorships received (already ledger income). */
  sponsorshipReceivedCents: number;
  /** The value of credit sponsorships committed, invoiced or received: never on the ledger. */
  sponsorshipCreditsCents: number;
  burnByMonth: { month: string; inCents: number; outCents: number }[];
  unreconciledOver60DaysCount: number;
  runway: Runway | null;
  /** Money in and out this period (the ledger: what counts toward the balance). */
  inTotalCents: number;
  outTotalCents: number;
  /** Expenses submitted and waiting for approval. */
  pendingApproval: { count: number; cents: number };
  /** Money out by transaction type. */
  spendByKind: { kind: TransactionKind; cents: number }[];
  /** The running balance after each day with activity. */
  balanceTrend: { date: string; balanceCents: number }[];
  /** The latest ledger transactions, newest first. */
  recent: DashboardTransaction[];
  /** This period's largest money out. */
  topExpenses: DashboardTransaction[];
  /** Money in by transaction type. */
  incomeByKind: { kind: TransactionKind; cents: number }[];
  /** Expenses waiting to be approved or paid back, oldest first. */
  reimbursementQueue: {
    id: string;
    description: string;
    amountCents: number;
    status: TransactionStatus;
    submitter: string;
    occurredAt: Date;
  }[];
}

export interface DashboardTransaction {
  id: string;
  description: string;
  amountCents: number;
  direction: TransactionDirection;
  kind: TransactionKind;
  occurredAt: Date;
  categoryName: string | null;
}

/**
 * The active period's dashboard. Balance, category spend, burn and runway
 * all read the same ledger: non-voided transactions, less expenses still in
 * draft or rejected (countsTowardBalance). Meetings, for the per-meeting
 * average, are the period's calendar events other than board meetings: those
 * are the officers' own and carry no club spending.
 */
export async function getDashboardData(
  db: TxClient,
  organizationId: string,
  now: Date = new Date(),
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
      sponsorshipCreditsCents: 0,
      burnByMonth: [],
      unreconciledOver60DaysCount: 0,
      runway: null,
      inTotalCents: 0,
      outTotalCents: 0,
      pendingApproval: { count: 0, cents: 0 },
      spendByKind: [],
      balanceTrend: [],
      recent: [],
      topExpenses: [],
      incomeByKind: [],
      reimbursementQueue: [],
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
      id: true,
      description: true,
      direction: true,
      kind: true,
      status: true,
      amountCents: true,
      occurredAt: true,
      reconciledAt: true,
      categoryId: true,
      submittedBy: { select: { name: true, email: true } },
    },
  });
  const meetings = await db.event.findMany({
    where: {
      organizationId,
      deletedAt: null,
      mergedIntoId: null,
      kind: { not: EventKind.BOARD_MEETING },
      startsAt: { gte: period.startsOn, lt: new Date(period.endsOn.getTime() + DAY_MS) },
    },
    select: { startsAt: true },
  });

  const ledger = allTransactions.filter((t) => countsTowardBalance(t.status));
  const spending = ledger.filter((t) => t.direction === TransactionDirection.OUT);

  let inTotal = 0;
  let outTotal = 0;
  for (const t of ledger) {
    if (t.direction === TransactionDirection.IN) inTotal += t.amountCents;
    else outTotal += t.amountCents;
  }

  let outstandingReimbursementsCents = 0;
  for (const t of allTransactions) {
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
  for (const t of spending) {
    if (!t.categoryId) continue;
    spentByCategory.set(t.categoryId, (spentByCategory.get(t.categoryId) ?? 0) + t.amountCents);
  }
  const categorySpent = categories.map((c) => ({
    id: c.id,
    name: c.name,
    allocatedCents: c.allocatedCents,
    spentCents: spentByCategory.get(c.id) ?? 0,
  }));

  const burnMap = new Map<string, { inCents: number; outCents: number }>();
  for (const t of ledger) {
    const month = t.occurredAt.toISOString().slice(0, 7);
    const entry = burnMap.get(month) ?? { inCents: 0, outCents: 0 };
    if (t.direction === TransactionDirection.IN) entry.inCents += t.amountCents;
    else entry.outCents += t.amountCents;
    burnMap.set(month, entry);
  }
  const burnByMonth = [...burnMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  const sixtyDaysAgo = new Date(now.getTime() - 60 * DAY_MS);
  const unreconciledOver60DaysCount = allTransactions.filter(
    (t) => !t.reconciledAt && t.occurredAt < sixtyDaysAgo,
  ).length;

  const balanceCents = inTotal - outTotal;

  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const toRow = (t: (typeof ledger)[number]): DashboardTransaction => ({
    id: t.id,
    description: t.description,
    amountCents: t.amountCents,
    direction: t.direction,
    kind: t.kind,
    occurredAt: t.occurredAt,
    categoryName: t.categoryId ? (categoryName.get(t.categoryId) ?? null) : null,
  });
  const byDate = [...ledger].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const trend = new Map<string, number>();
  let running = 0;
  for (const t of byDate) {
    running += t.direction === TransactionDirection.IN ? t.amountCents : -t.amountCents;
    trend.set(t.occurredAt.toISOString().slice(0, 10), running);
  }
  const kindTotals = new Map<TransactionKind, number>();
  for (const t of spending) kindTotals.set(t.kind, (kindTotals.get(t.kind) ?? 0) + t.amountCents);
  const incomeTotals = new Map<TransactionKind, number>();
  for (const t of ledger) {
    if (t.direction === TransactionDirection.IN) incomeTotals.set(t.kind, (incomeTotals.get(t.kind) ?? 0) + t.amountCents);
  }
  const queue = allTransactions
    .filter(
      (t) =>
        t.kind === TransactionKind.EXPENSE &&
        (t.status === TransactionStatus.SUBMITTED || t.status === TransactionStatus.APPROVED),
    )
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const pending = allTransactions.filter(
    (t) => t.kind === TransactionKind.EXPENSE && t.status === TransactionStatus.SUBMITTED,
  );
  const cashSponsorships = sponsorships.filter((s) => s.type === "CASH");
  const sponsorshipCommittedCents = cashSponsorships
    .filter((s) => s.status === "COMMITTED" || s.status === "INVOICED")
    .reduce((sum, s) => sum + s.amountCents, 0);

  return {
    period: {
      id: period.id,
      label: period.label,
      startsOn: period.startsOn,
      endsOn: period.endsOn,
    },
    balanceCents,
    totalAllocatedCents: categories.reduce((sum, c) => sum + c.allocatedCents, 0),
    categories: categorySpent,
    outstandingReimbursementsCents,
    sponsorshipCommittedCents,
    sponsorshipReceivedCents: cashSponsorships
      .filter((s) => s.status === "RECEIVED")
      .reduce((sum, s) => sum + s.amountCents, 0),
    sponsorshipCreditsCents: sponsorships
      .filter(
        (s) =>
          s.type === "CREDITS" &&
          (s.status === "COMMITTED" || s.status === "INVOICED" || s.status === "RECEIVED"),
      )
      .reduce((sum, s) => sum + s.amountCents, 0),
    burnByMonth,
    unreconciledOver60DaysCount,
    runway: computeRunway({
      period,
      balanceCents,
      spending,
      // Received sponsorships are ledger income already; these are still to come.
      expectedIncomeCents: sponsorshipCommittedCents,
      meetingStarts: meetings.map((m) => m.startsAt),
      now,
    }),
    inTotalCents: inTotal,
    outTotalCents: outTotal,
    pendingApproval: {
      count: pending.length,
      cents: pending.reduce((sum, t) => sum + t.amountCents, 0),
    },
    spendByKind: [...kindTotals.entries()]
      .map(([kind, cents]) => ({ kind, cents }))
      .sort((a, b) => b.cents - a.cents),
    balanceTrend: [...trend.entries()].map(([date, balanceCents]) => ({ date, balanceCents })),
    recent: byDate.slice(-8).reverse().map(toRow),
    topExpenses: [...spending]
      .sort((a, b) => b.amountCents - a.amountCents)
      .slice(0, 5)
      .map(toRow),
    incomeByKind: [...incomeTotals.entries()]
      .map(([kind, cents]) => ({ kind, cents }))
      .sort((a, b) => b.cents - a.cents),
    reimbursementQueue: queue.slice(0, 12).map((t) => ({
      id: t.id,
      description: t.description,
      amountCents: t.amountCents,
      status: t.status,
      submitter: t.submittedBy.name?.trim() || t.submittedBy.email,
      occurredAt: t.occurredAt,
    })),
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
