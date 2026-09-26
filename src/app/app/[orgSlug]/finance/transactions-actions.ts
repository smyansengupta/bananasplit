"use server";

import { z } from "zod";

import { TransactionDirection, TransactionKind } from "@/generated/prisma/client";
import { can, requirePermission } from "@/lib/auth/permissions";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import {
  nextExpenseStatus,
  type ExpenseTransition,
} from "@/lib/finance/reimbursement-state-machine";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

/**
 * Transactions and the expense workflow (0C). Every action runs in one
 * withOrgAction transaction as app_user. The app checks give the messages;
 * the database repeats them: the Transaction policies (6.10) keep
 * submitters to their own open expenses, and the transaction_guard trigger
 * enforces separation of duties against the acting user (nobody approves,
 * rejects or reimburses their own expense; approvedById and reconciledById
 * are the actor). Audit rows go through app.write_finance_audit in the same
 * transaction.
 *
 * Error semantics: every action returns its { error } before any write
 * (case a). A rule the database refuses after the app check passed (say, a
 * concurrent change) throws and rolls the whole action back, audit row and
 * outbox job included. The submitter's status email is an outbox job
 * (reimbursement-email) enqueued in the same transaction: no network I/O
 * runs inside it, and a rolled-back transition sends nothing.
 */

interface ActionResult {
  error?: string;
  transactionId?: string;
}

const DIRECTION_VALUES = Object.values(TransactionDirection) as [
  TransactionDirection,
  ...TransactionDirection[],
];
const KIND_VALUES = Object.values(TransactionKind) as [TransactionKind, ...TransactionKind[]];

const EXPECTED_DIRECTION: Partial<Record<TransactionKind, TransactionDirection>> = {
  EXPENSE: TransactionDirection.OUT,
  SPONSORSHIP: TransactionDirection.IN,
  OTHER_INCOME: TransactionDirection.IN,
};

const transactionInputSchema = z.object({
  budgetPeriodId: z.string(),
  categoryId: z.string().nullable().optional(),
  direction: z.enum(DIRECTION_VALUES),
  kind: z.enum(KIND_VALUES),
  amountCents: z.number().int().positive("Amount must be greater than zero."),
  description: z.string().trim().min(1, "Description is required").max(500),
  counterparty: z.string().max(200).nullable().optional(),
  occurredAt: z.string(),
  paymentMethod: z.string().max(100).nullable().optional(),
  eventId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
});

/**
 * The category must be this org's AND in the transaction's period. The
 * period is never taken from an update payload (0A Fix 2): on update it is
 * always the existing row's budgetPeriodId.
 */
async function assertCategoryBelongsToPeriod(
  ctx: OrgContext,
  categoryId: string | null | undefined,
  budgetPeriodId: string,
) {
  if (!categoryId) return null;
  const category = await ctx.db.budgetCategory.findFirst({
    where: { id: categoryId, budgetPeriodId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  return category ? null : "That category doesn't belong to the selected budget period.";
}

/**
 * eventId and taskId are client-supplied links: each must be a row of this
 * org (0A Fix 2). A foreign id gets the same message as a missing one. The
 * database's same_org_refs trigger enforces the same rule (T14a-b).
 */
async function assertLinksBelongToOrg(
  ctx: OrgContext,
  links: { eventId?: string | null; taskId?: string | null },
) {
  if (links.eventId) {
    const event = await ctx.db.event.findFirst({
      where: { id: links.eventId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!event) return "That event doesn't exist in this organization.";
  }
  if (links.taskId) {
    const task = await ctx.db.task.findFirst({
      where: { id: links.taskId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!task) return "That task doesn't exist in this organization.";
  }
  return null;
}

export const createTransaction = withOrgAction(
  async (ctx, input: unknown): Promise<ActionResult> => {
    const parsed = transactionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    if (data.kind !== TransactionKind.EXPENSE && !can(ctx, "finance.manage")) {
      return { error: "Only a treasurer or owner can record this kind of transaction." };
    }

    const expectedDirection = EXPECTED_DIRECTION[data.kind];
    if (expectedDirection && data.direction !== expectedDirection) {
      return { error: `${data.kind} transactions must be ${expectedDirection}.` };
    }

    const period = await ctx.db.budgetPeriod.findFirst({
      where: { id: data.budgetPeriodId, organizationId: ctx.organizationId },
    });
    if (!period) return { error: "Budget period not found." };

    const categoryError = await assertCategoryBelongsToPeriod(ctx, data.categoryId, period.id);
    if (categoryError) return { error: categoryError };

    const linkError = await assertLinksBelongToOrg(ctx, data);
    if (linkError) return { error: linkError };

    const created = await ctx.db.transaction.create({
      data: {
        organizationId: ctx.organizationId,
        budgetPeriodId: data.budgetPeriodId,
        categoryId: data.categoryId ?? null,
        direction: data.direction,
        kind: data.kind,
        amountCents: data.amountCents,
        description: data.description,
        counterparty: data.counterparty ?? null,
        occurredAt: new Date(data.occurredAt),
        paymentMethod: data.paymentMethod ?? null,
        eventId: data.eventId ?? null,
        taskId: data.taskId ?? null,
        submittedById: ctx.userId,
        status: data.kind === TransactionKind.EXPENSE ? "DRAFT" : "NOT_APPLICABLE",
      },
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      transactionId: created.id,
      action: "CREATE",
      after: created,
    });

    return { transactionId: created.id };
  },
);

// budgetPeriodId is not updatable (a transaction never moves between
// periods), so it is not accepted from the client at all: it used to be
// read only for the category check and never written, which let a foreign
// period vouch for a foreign category (0A Fix 2). Unknown keys are stripped.
const updateInputSchema = transactionInputSchema.omit({ budgetPeriodId: true }).partial();

export const updateTransaction = withOrgAction(
  async (ctx, transactionId: string, input: unknown): Promise<ActionResult> => {
    const existing = await ctx.db.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (existing.reconciledAt) {
      return { error: "This transaction is reconciled and locked. Unlock it first." };
    }

    const isOwnDraftExpense = existing.submittedById === ctx.userId && existing.status === "DRAFT";
    if (!can(ctx, "finance.manage") && !isOwnDraftExpense) {
      return { error: "You don't have permission to edit this transaction." };
    }

    const parsed = updateInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    if (data.categoryId !== undefined) {
      const categoryError = await assertCategoryBelongsToPeriod(
        ctx,
        data.categoryId,
        existing.budgetPeriodId,
      );
      if (categoryError) return { error: categoryError };
    }

    const linkError = await assertLinksBelongToOrg(ctx, data);
    if (linkError) return { error: linkError };

    const updated = await ctx.db.transaction.update({
      where: { id: transactionId },
      data: {
        categoryId: data.categoryId,
        amountCents: data.amountCents,
        description: data.description,
        counterparty: data.counterparty,
        occurredAt: data.occurredAt ? new Date(data.occurredAt) : undefined,
        paymentMethod: data.paymentMethod,
        eventId: data.eventId,
        taskId: data.taskId,
      },
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      transactionId,
      action: "UPDATE",
      before: existing,
      after: updated,
    });

    return { transactionId };
  },
);

export const voidTransaction = withOrgAction(
  async (ctx, transactionId: string, reason: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");

    if (!reason?.trim()) {
      return { error: "A reason is required to void a transaction." };
    }

    const existing = await ctx.db.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (existing.reconciledAt) {
      return { error: "This transaction is reconciled and locked. Unlock it first." };
    }
    if (existing.voidedAt) return { error: "This transaction is already voided." };

    const updated = await ctx.db.transaction.update({
      where: { id: transactionId },
      data: { voidedAt: new Date(), voidReason: reason.trim() },
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      transactionId,
      action: "VOID",
      before: existing,
      after: updated,
    });

    return { transactionId };
  },
);

const TRANSITION_ACTIONS: Record<string, string> = {
  SUBMIT: "EXPENSE_SUBMIT",
  WITHDRAW: "EXPENSE_WITHDRAW",
  APPROVE: "EXPENSE_APPROVE",
  REJECT: "EXPENSE_REJECT",
  REIMBURSE: "EXPENSE_REIMBURSE",
  MARK_NOT_APPLICABLE: "EXPENSE_MARK_NOT_APPLICABLE",
};

async function applyExpenseTransition(
  ctx: OrgContext,
  transactionId: string,
  transition: ExpenseTransition,
  extra: { rejectionReason?: string; reimbursedMethod?: string } = {},
): Promise<ActionResult> {
  const existing = await ctx.db.transaction.findFirst({
    where: { id: transactionId, organizationId: ctx.organizationId, kind: TransactionKind.EXPENSE },
  });
  if (!existing) return { error: "Expense not found." };
  if (existing.reconciledAt) {
    return { error: "This transaction is reconciled and locked. Unlock it first." };
  }

  if (transition === "REJECT" && !extra.rejectionReason?.trim()) {
    return { error: "A reason is required to reject an expense." };
  }

  const result = nextExpenseStatus({
    currentStatus: existing.status,
    transition,
    actorId: ctx.userId,
    submitterId: existing.submittedById,
    actorHasFinanceAccess: can(ctx, "finance.manage"),
  });
  if ("error" in result) return { error: result.error };

  const row = await ctx.db.transaction.update({
    where: { id: transactionId },
    data: {
      status: result.status,
      approvedById: transition === "APPROVE" ? ctx.userId : undefined,
      approvedAt: transition === "APPROVE" ? new Date() : undefined,
      rejectionReason: transition === "REJECT" ? extra.rejectionReason!.trim() : undefined,
      reimbursedAt: transition === "REIMBURSE" ? new Date() : undefined,
      reimbursementMethod:
        transition === "REIMBURSE" ? (extra.reimbursedMethod?.trim() ?? null) : undefined,
    },
  });
  await writeFinanceAuditLog(ctx.db, {
    organizationId: ctx.organizationId,
    transactionId,
    action: TRANSITION_ACTIONS[transition],
    before: { status: existing.status },
    after: { status: row.status },
  });
  // The submitter's status email goes through the outbox, in this same
  // transaction: nothing is sent if the transition rolls back, and the
  // action never waits on the mail provider.
  if (row.status === "APPROVED" || row.status === "REJECTED" || row.status === "REIMBURSED") {
    await enqueueJob(ctx.db, {
      orgId: ctx.organizationId,
      kind: "reimbursement-email",
      key: `${transactionId}:${row.status}`,
      payload: { transactionId, status: row.status },
    });
  }

  return { transactionId: row.id };
}

export const submitExpense = withOrgAction(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "SUBMIT"),
);

export const withdrawExpense = withOrgAction(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "WITHDRAW"),
);

export const markExpenseNotApplicable = withOrgAction(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "MARK_NOT_APPLICABLE"),
);

export const approveExpense = withOrgAction(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "APPROVE"),
);

export const rejectExpense = withOrgAction(async (ctx, transactionId: string, reason: string) =>
  applyExpenseTransition(ctx, transactionId, "REJECT", { rejectionReason: reason }),
);

export const reimburseExpense = withOrgAction(async (ctx, transactionId: string, method: string) =>
  applyExpenseTransition(ctx, transactionId, "REIMBURSE", { reimbursedMethod: method }),
);

export const reconcileTransaction = withOrgAction(
  async (ctx, transactionId: string, statementRef: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");

    const existing = await ctx.db.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (existing.reconciledAt) return { error: "Already reconciled." };

    const updated = await ctx.db.transaction.update({
      where: { id: transactionId },
      data: {
        reconciledAt: new Date(),
        reconciledById: ctx.userId,
        statementRef: statementRef?.trim() || null,
      },
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      transactionId,
      action: "RECONCILE",
      before: { reconciledAt: existing.reconciledAt },
      after: { reconciledAt: updated.reconciledAt, statementRef: updated.statementRef },
    });

    return { transactionId };
  },
);

export const unlockTransaction = withOrgAction(
  async (ctx, transactionId: string, reason: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");

    if (!reason?.trim()) {
      return { error: "A reason is required to unlock a reconciled transaction." };
    }

    const existing = await ctx.db.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (!existing.reconciledAt) return { error: "This transaction isn't reconciled." };

    const updated = await ctx.db.transaction.update({
      where: { id: transactionId },
      data: { reconciledAt: null, reconciledById: null, statementRef: null },
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      transactionId,
      action: "UNLOCK",
      before: { reconciledAt: existing.reconciledAt, statementRef: existing.statementRef },
      after: { reconciledAt: updated.reconciledAt, reason: reason.trim() },
    });

    return { transactionId };
  },
);
