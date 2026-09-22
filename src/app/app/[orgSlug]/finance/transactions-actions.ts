"use server";

import { z } from "zod";

import { Role, TransactionDirection, TransactionKind } from "@/generated/prisma/client";
import { requireFinanceAccess } from "@/lib/auth/guards";
import { withOrgContext } from "@/lib/auth/with-org-context";
import { sendReimbursementStatusEmail } from "@/lib/email";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import {
  nextExpenseStatus,
  type ExpenseTransition,
} from "@/lib/finance/reimbursement-state-machine";
import { prisma } from "@/lib/prisma";

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
  organizationId: string,
  categoryId: string | null | undefined,
  budgetPeriodId: string,
) {
  if (!categoryId) return null;
  const category = await prisma.budgetCategory.findFirst({
    where: { id: categoryId, budgetPeriodId, organizationId },
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
  organizationId: string,
  links: { eventId?: string | null; taskId?: string | null },
) {
  if (links.eventId) {
    const event = await prisma.event.findFirst({
      where: { id: links.eventId, organizationId },
      select: { id: true },
    });
    if (!event) return "That event doesn't exist in this organization.";
  }
  if (links.taskId) {
    const task = await prisma.task.findFirst({
      where: { id: links.taskId, organizationId },
      select: { id: true },
    });
    if (!task) return "That task doesn't exist in this organization.";
  }
  return null;
}

export const createTransaction = withOrgContext(
  async (ctx, input: unknown): Promise<ActionResult> => {
    const parsed = transactionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    const isFinance = ctx.role === Role.OWNER || ctx.role === Role.TREASURER;
    if (data.kind !== TransactionKind.EXPENSE && !isFinance) {
      return { error: "Only a treasurer or owner can record this kind of transaction." };
    }

    const expectedDirection = EXPECTED_DIRECTION[data.kind];
    if (expectedDirection && data.direction !== expectedDirection) {
      return { error: `${data.kind} transactions must be ${expectedDirection}.` };
    }

    const period = await prisma.budgetPeriod.findFirst({
      where: { id: data.budgetPeriodId, organizationId: ctx.organizationId },
    });
    if (!period) return { error: "Budget period not found." };

    const categoryError = await assertCategoryBelongsToPeriod(
      ctx.organizationId,
      data.categoryId,
      period.id,
    );
    if (categoryError) return { error: categoryError };

    const linkError = await assertLinksBelongToOrg(ctx.organizationId, data);
    if (linkError) return { error: linkError };

    const transaction = await prisma.$transaction(async (tx) => {
      const created = await tx.transaction.create({
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
          submittedById: ctx.user.id,
          status: data.kind === TransactionKind.EXPENSE ? "DRAFT" : "NOT_APPLICABLE",
        },
      });
      await writeFinanceAuditLog(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        transactionId: created.id,
        action: "CREATE",
        after: created,
      });
      return created;
    });

    return { transactionId: transaction.id };
  },
);

// budgetPeriodId is not updatable (a transaction never moves between
// periods), so it is not accepted from the client at all: it used to be
// read only for the category check and never written, which let a foreign
// period vouch for a foreign category (0A Fix 2). Unknown keys are stripped.
const updateInputSchema = transactionInputSchema.omit({ budgetPeriodId: true }).partial();

export const updateTransaction = withOrgContext(
  async (ctx, transactionId: string, input: unknown): Promise<ActionResult> => {
    const existing = await prisma.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (existing.reconciledAt) {
      return { error: "This transaction is reconciled and locked. Unlock it first." };
    }

    const isFinance = ctx.role === Role.OWNER || ctx.role === Role.TREASURER;
    const isOwnDraftExpense = existing.submittedById === ctx.user.id && existing.status === "DRAFT";
    if (!isFinance && !isOwnDraftExpense) {
      return { error: "You don't have permission to edit this transaction." };
    }

    const parsed = updateInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    if (data.categoryId !== undefined) {
      const categoryError = await assertCategoryBelongsToPeriod(
        ctx.organizationId,
        data.categoryId,
        existing.budgetPeriodId,
      );
      if (categoryError) return { error: categoryError };
    }

    const linkError = await assertLinksBelongToOrg(ctx.organizationId, data);
    if (linkError) return { error: linkError };

    await prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
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
      await writeFinanceAuditLog(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        transactionId,
        action: "UPDATE",
        before: existing,
        after: updated,
      });
    });

    return { transactionId };
  },
);

export const voidTransaction = withOrgContext(
  async (ctx, transactionId: string, reason: string): Promise<ActionResult> => {
    await requireFinanceAccess(ctx.organizationId);

    if (!reason?.trim()) {
      return { error: "A reason is required to void a transaction." };
    }

    const existing = await prisma.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (existing.reconciledAt) {
      return { error: "This transaction is reconciled and locked. Unlock it first." };
    }
    if (existing.voidedAt) return { error: "This transaction is already voided." };

    await prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: { voidedAt: new Date(), voidReason: reason.trim() },
      });
      await writeFinanceAuditLog(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        transactionId,
        action: "VOID",
        before: existing,
        after: updated,
      });
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
  ctx: { organizationId: string; user: { id: string }; role: Role },
  transactionId: string,
  transition: ExpenseTransition,
  extra: { rejectionReason?: string; reimbursedMethod?: string } = {},
): Promise<ActionResult> {
  const existing = await prisma.transaction.findFirst({
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
    actorId: ctx.user.id,
    submitterId: existing.submittedById,
    actorHasFinanceAccess: ctx.role === Role.OWNER || ctx.role === Role.TREASURER,
  });
  if ("error" in result) return { error: result.error };

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: result.status,
        approvedById: transition === "APPROVE" ? ctx.user.id : undefined,
        approvedAt: transition === "APPROVE" ? new Date() : undefined,
        rejectionReason: transition === "REJECT" ? extra.rejectionReason!.trim() : undefined,
        reimbursedAt: transition === "REIMBURSE" ? new Date() : undefined,
        reimbursementMethod:
          transition === "REIMBURSE" ? (extra.reimbursedMethod?.trim() ?? null) : undefined,
      },
    });
    await writeFinanceAuditLog(tx, {
      organizationId: ctx.organizationId,
      actorId: ctx.user.id,
      transactionId,
      action: TRANSITION_ACTIONS[transition],
      before: { status: existing.status },
      after: { status: row.status },
    });
    return row;
  });

  if (["APPROVE", "REJECT", "REIMBURSE"].includes(transition)) {
    const submitter = await prisma.user.findUnique({ where: { id: existing.submittedById } });
    if (submitter) {
      await sendReimbursementStatusEmail({
        to: submitter.email,
        description: existing.description,
        status: updated.status,
        rejectionReason: updated.rejectionReason,
      });
    }
  }

  return { transactionId };
}

export const submitExpense = withOrgContext(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "SUBMIT"),
);

export const withdrawExpense = withOrgContext(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "WITHDRAW"),
);

export const markExpenseNotApplicable = withOrgContext(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "MARK_NOT_APPLICABLE"),
);

export const approveExpense = withOrgContext(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "APPROVE"),
);

export const rejectExpense = withOrgContext(async (ctx, transactionId: string, reason: string) =>
  applyExpenseTransition(ctx, transactionId, "REJECT", { rejectionReason: reason }),
);

export const reimburseExpense = withOrgContext(async (ctx, transactionId: string, method: string) =>
  applyExpenseTransition(ctx, transactionId, "REIMBURSE", { reimbursedMethod: method }),
);

export const reconcileTransaction = withOrgContext(
  async (ctx, transactionId: string, statementRef: string): Promise<ActionResult> => {
    await requireFinanceAccess(ctx.organizationId);

    const existing = await prisma.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (existing.reconciledAt) return { error: "Already reconciled." };

    await prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: {
          reconciledAt: new Date(),
          reconciledById: ctx.user.id,
          statementRef: statementRef?.trim() || null,
        },
      });
      await writeFinanceAuditLog(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        transactionId,
        action: "RECONCILE",
        before: { reconciledAt: existing.reconciledAt },
        after: { reconciledAt: updated.reconciledAt, statementRef: updated.statementRef },
      });
    });

    return { transactionId };
  },
);

export const unlockTransaction = withOrgContext(
  async (ctx, transactionId: string, reason: string): Promise<ActionResult> => {
    await requireFinanceAccess(ctx.organizationId);

    if (!reason?.trim()) {
      return { error: "A reason is required to unlock a reconciled transaction." };
    }

    const existing = await prisma.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (!existing.reconciledAt) return { error: "This transaction isn't reconciled." };

    await prisma.$transaction(async (tx) => {
      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: { reconciledAt: null, reconciledById: null, statementRef: null },
      });
      await writeFinanceAuditLog(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.user.id,
        transactionId,
        action: "UNLOCK",
        before: { reconciledAt: existing.reconciledAt, statementRef: existing.statementRef },
        after: { reconciledAt: updated.reconciledAt, reason: reason.trim() },
      });
    });

    return { transactionId };
  },
);
