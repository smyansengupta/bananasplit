"use server";

import { z } from "zod";

import { TransactionDirection, TransactionKind } from "@/generated/prisma/client";
import { can, requirePermission } from "@/lib/auth/permissions";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { DELETED_TRANSACTION_REASON } from "@/lib/finance/deleted";
import {
  nextExpenseStatus,
  type ExpenseTransition,
} from "@/lib/finance/reimbursement-state-machine";
import { localDateKey } from "@/lib/tasks/dates";
import { withOrgAction, type OrgContext } from "@/server/db/context";
import { ensureActivePeriod } from "@/server/finance/periods";
import { enqueueJob } from "@/server/jobs/enqueue";
import { notifyUser } from "@/server/notifications";

import { getCategoryOptions } from "./queries";

/** Every action here belongs to finance (withOrgAction's space check). */
const financeAction: typeof withOrgAction = (handler, options) =>
  withOrgAction(handler, { onRefused: "return", ...options, feature: "finance" });

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
  /** Empty or missing: the active period (a treasurer's first one is made on the spot). */
  budgetPeriodId: z.string().nullable().optional(),
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
  /**
   * An expense is either a REQUEST (someone paid and wants it back: it goes
   * straight to the treasurer, SUBMITTED, unless `draft`) or a RECORD (the
   * club paid: it counts at once, NOT_APPLICABLE). Members can only request;
   * left out, a treasurer records and a member requests.
   */
  purpose: z.enum(["request", "record"]).optional(),
  /** Keep a request to yourself for now instead of sending it. */
  draft: z.boolean().optional(),
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
  const wrong = "That category doesn't belong to the selected budget period.";
  // A member can't read category rows (finance only): their check is the
  // expense form's own list, app.expense_categories.
  if (!can(ctx, "finance.manage")) {
    const options = await getCategoryOptions(ctx.db, [{ id: budgetPeriodId }]);
    return options.some((c) => c.id === categoryId) ? null : wrong;
  }
  const category = await ctx.db.budgetCategory.findFirst({
    where: { id: categoryId, budgetPeriodId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  return category ? null : wrong;
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

export const createTransaction = financeAction(
  async (ctx, input: unknown): Promise<ActionResult> => {
    const parsed = transactionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const data = parsed.data;

    if (data.kind !== TransactionKind.EXPENSE && !can(ctx, "finance.manage")) {
      return { error: "Only an owner, admin or treasurer can record this kind of transaction." };
    }

    const expectedDirection = EXPECTED_DIRECTION[data.kind];
    if (expectedDirection && data.direction !== expectedDirection) {
      return { error: `${data.kind} transactions must be ${expectedDirection}.` };
    }

    // No period picked: the active one. Finance never dead-ends on "create a
    // budget period first": for a treasurer the first one is made here
    // (this year, starter categories). A member's request needs one
    // that a treasurer set up, since only they can create periods.
    let periodId = data.budgetPeriodId || null;
    if (!periodId) {
      if (can(ctx, "finance.manage")) {
        periodId = (await ensureActivePeriod(ctx.db, ctx.organizationId)).id;
      } else {
        const active = await ctx.db.budgetPeriod.findFirst({
          where: { organizationId: ctx.organizationId, isActive: true },
          select: { id: true },
        });
        if (!active) {
          return { error: "Finance isn't set up yet. Ask your treasurer to open Finance once." };
        }
        periodId = active.id;
      }
    }

    const period = await ctx.db.budgetPeriod.findFirst({
      where: { id: periodId, organizationId: ctx.organizationId },
    });
    if (!period) return { error: "Budget period not found." };

    const categoryError = await assertCategoryBelongsToPeriod(ctx, data.categoryId, period.id);
    if (categoryError) return { error: categoryError };

    const linkError = await assertLinksBelongToOrg(ctx, data);
    if (linkError) return { error: linkError };

    // A treasurer's own expense counts the moment it's logged (the club
    // paid it); asking to be paid back is the request flow. Before this,
    // every expense started as a draft that the totals left out.
    const finance = can(ctx, "finance.manage");
    const purpose = finance && data.purpose !== "request" ? "record" : "request";
    const status =
      data.kind !== TransactionKind.EXPENSE || purpose === "record"
        ? "NOT_APPLICABLE"
        : data.draft
          ? "DRAFT"
          : "SUBMITTED";

    const created = await ctx.db.transaction.create({
      data: {
        organizationId: ctx.organizationId,
        budgetPeriodId: period.id,
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
        status,
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
const updateInputSchema = transactionInputSchema
  .omit({ budgetPeriodId: true, purpose: true, draft: true })
  .partial();

export const updateTransaction = financeAction(
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

export const voidTransaction = financeAction(
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

/**
 * "Delete": takes a transaction out of every list and total. Money rows are
 * never erased (no DELETE grant; the audit trail keeps them): it is voided
 * with the reason "Deleted", and restoreTransaction brings it back.
 * Treasurers and owners delete any unlocked transaction; a member deletes
 * their own expense while it's still a draft or waiting for approval.
 */
export const deleteTransaction = financeAction(
  async (ctx, transactionId: string): Promise<ActionResult> => {
    const existing = await ctx.db.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (existing.voidedAt) return { transactionId };
    const ownOpen =
      existing.submittedById === ctx.userId &&
      existing.kind === TransactionKind.EXPENSE &&
      (existing.status === "DRAFT" || existing.status === "SUBMITTED");
    if (!can(ctx, "finance.manage") && !ownOpen) {
      return {
        error:
          "Only an owner, admin or treasurer can delete this. You can delete your own requests until they're approved.",
      };
    }
    if (existing.reconciledAt) {
      return {
        error:
          "This transaction is reconciled against a bank statement and locked. Unlock it first.",
      };
    }

    const updated = await ctx.db.transaction.update({
      where: { id: transactionId },
      data: { voidedAt: new Date(), voidReason: DELETED_TRANSACTION_REASON },
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

/** Undoes deleteTransaction (or a void): back in the lists and totals. */
export const restoreTransaction = financeAction(
  async (ctx, transactionId: string): Promise<ActionResult> => {
    const existing = await ctx.db.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
    });
    if (!existing) return { error: "Transaction not found." };
    if (!existing.voidedAt) return { transactionId };
    const ownOpen =
      existing.submittedById === ctx.userId &&
      existing.kind === TransactionKind.EXPENSE &&
      (existing.status === "DRAFT" || existing.status === "SUBMITTED");
    if (!can(ctx, "finance.manage") && !ownOpen) {
      return { error: "Only an owner, admin or treasurer can restore this." };
    }

    const updated = await ctx.db.transaction.update({
      where: { id: transactionId },
      data: { voidedAt: null, voidReason: null },
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      transactionId,
      action: "RESTORE",
      before: existing,
      after: updated,
    });
    return { transactionId };
  },
);

const TRANSITION_ACTIONS: Record<string, string> = {
  APPROVE_AND_PAY: "EXPENSE_REIMBURSE",
  RESUBMIT: "EXPENSE_SUBMIT",
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
  extra: {
    rejectionReason?: string;
    reimbursedMethod?: string;
    /** RESUBMIT: the submitter's fixes, written with the status change. */
    edits?: {
      amountCents?: number;
      description?: string;
      categoryId?: string | null;
      occurredAt?: Date;
    };
  } = {},
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

  const approves = transition === "APPROVE" || transition === "APPROVE_AND_PAY";
  const pays = transition === "REIMBURSE" || transition === "APPROVE_AND_PAY";
  const resubmits = transition === "RESUBMIT";
  const now = new Date();
  const row = await ctx.db.transaction.update({
    where: { id: transactionId },
    data: {
      status: result.status,
      approvedById: approves ? ctx.userId : resubmits ? null : undefined,
      approvedAt: approves ? now : resubmits ? null : undefined,
      rejectionReason:
        transition === "REJECT" ? extra.rejectionReason!.trim() : resubmits ? null : undefined,
      reimbursedAt: pays ? now : undefined,
      reimbursementMethod: pays ? extra.reimbursedMethod?.trim() || null : undefined,
      ...(extra.edits ?? {}),
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

export const submitExpense = financeAction(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "SUBMIT"),
);

export const withdrawExpense = financeAction(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "WITHDRAW"),
);

export const markExpenseNotApplicable = financeAction(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "MARK_NOT_APPLICABLE"),
);

export const approveExpense = financeAction(async (ctx, transactionId: string) =>
  applyExpenseTransition(ctx, transactionId, "APPROVE"),
);

export const rejectExpense = financeAction(async (ctx, transactionId: string, reason: string) =>
  applyExpenseTransition(ctx, transactionId, "REJECT", { rejectionReason: reason }),
);

export const reimburseExpense = financeAction(async (ctx, transactionId: string, method: string) =>
  applyExpenseTransition(ctx, transactionId, "REIMBURSE", { reimbursedMethod: method }),
);

/**
 * Ask for receipt (Transactions row): a note to whoever paid, asking them to
 * attach the receipt, linked to their request. A treasurer's, once a day per
 * expense; logged in the finance audit. It rides on the mention
 * notification (Inbox and email), there being no finance type of its own.
 */
export const askForReceipt = financeAction(
  async (ctx, transactionId: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const t = await ctx.db.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId, voidedAt: null },
      select: {
        id: true,
        description: true,
        amountCents: true,
        submittedById: true,
        _count: { select: { receipts: true } },
      },
    });
    if (!t) return { error: "Transaction not found." };
    if (t._count.receipts > 0) return { error: "It has a receipt now." };
    if (t.submittedById === ctx.userId) return { error: "This one is yours: attach it yourself." };
    const org = await ctx.db.organization.findUnique({
      where: { id: ctx.organizationId },
      select: { slug: true, timezone: true },
    });
    const me = await ctx.db.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
    const amount = (t.amountCents / 100).toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
    });
    await notifyUser(ctx.db, ctx.organizationId, t.submittedById, {
      type: "TASK_MENTIONED",
      title: `${me?.name?.trim() || "Your treasurer"} needs the receipt for ${t.description}`,
      body: `${t.description}, ${amount}. Add the receipt to it when you can.`,
      linkUrl: `/app/${org?.slug ?? ""}/finance/my-reimbursements?open=${t.id}`,
      actorId: ctx.userId,
      dedupeKey: `receipt:${t.id}:${localDateKey(new Date(), org?.timezone ?? "UTC")}`,
    });
    await writeFinanceAuditLog(ctx.db, {
      organizationId: ctx.organizationId,
      transactionId: t.id,
      action: "RECEIPT_REQUESTED",
      after: { askedUserId: t.submittedById },
    });
    return { transactionId: t.id };
  },
);

/** Approve and mark paid at once, with how it was paid. */
export const approveAndPayExpense = financeAction(
  async (ctx, transactionId: string, method: string) =>
    applyExpenseTransition(ctx, transactionId, "APPROVE_AND_PAY", { reimbursedMethod: method }),
);

const resubmitSchema = z.object({
  amountCents: z.number().int().positive("Amount must be greater than zero.").optional(),
  description: z.string().trim().min(1, "Description is required").max(500).optional(),
  categoryId: z.string().nullable().optional(),
  occurredAt: z.string().optional(),
});

/** The submitter fixes a rejected request and sends it to the treasurer again. */
export const resubmitExpense = financeAction(
  async (ctx, transactionId: string, input: unknown): Promise<ActionResult> => {
    const parsed = resubmitSchema.safeParse(input ?? {});
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const existing = await ctx.db.transaction.findFirst({
      where: { id: transactionId, organizationId: ctx.organizationId },
      select: { budgetPeriodId: true },
    });
    if (!existing) return { error: "Expense not found." };
    if (parsed.data.categoryId) {
      const categoryError = await assertCategoryBelongsToPeriod(
        ctx,
        parsed.data.categoryId,
        existing.budgetPeriodId,
      );
      if (categoryError) return { error: categoryError };
    }
    return applyExpenseTransition(ctx, transactionId, "RESUBMIT", {
      edits: {
        amountCents: parsed.data.amountCents,
        description: parsed.data.description,
        categoryId: parsed.data.categoryId,
        occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
      },
    });
  },
);

/** What a bulk action did: how many went through, and the first reason one didn't. */
export interface BulkResult {
  done: number;
  failed: number;
  error?: string;
}

const MAX_BULK = 200;

async function eachOf(
  ids: readonly string[],
  run: (id: string) => Promise<ActionResult>,
): Promise<BulkResult> {
  const unique = [...new Set(ids)].slice(0, MAX_BULK);
  let done = 0;
  let failed = 0;
  let error: string | undefined;
  for (const id of unique) {
    const result = await run(id);
    if (result.error) {
      failed += 1;
      error ??= result.error;
    } else done += 1;
  }
  return { done, failed, error };
}

/**
 * The treasurer's queue in one go. Each row runs the same checks as one at
 * a time (your own requests are skipped, not approved); a row that can't
 * move is counted, not fatal.
 */
export const approveExpenses = financeAction(
  async (ctx, transactionIds: string[]): Promise<BulkResult> =>
    eachOf(transactionIds, (id) => applyExpenseTransition(ctx, id, "APPROVE")),
);

/** Mark several paid. Submitted ones are approved and paid in the same step. */
export const payExpenses = financeAction(
  async (ctx, transactionIds: string[], method: string): Promise<BulkResult> =>
    eachOf(transactionIds, async (id) => {
      const row = await ctx.db.transaction.findFirst({
        where: { id, organizationId: ctx.organizationId },
        select: { status: true },
      });
      if (!row) return { error: "Expense not found." };
      return applyExpenseTransition(
        ctx,
        id,
        row.status === "SUBMITTED" ? "APPROVE_AND_PAY" : "REIMBURSE",
        { reimbursedMethod: method },
      );
    }),
);

/** Reconcile several against one statement (the reference is optional). */
export const reconcileTransactions = financeAction(
  async (ctx, transactionIds: string[], statementRef?: string): Promise<BulkResult> => {
    requirePermission(ctx, "finance.manage");
    return eachOf(transactionIds, async (id) => {
      const existing = await ctx.db.transaction.findFirst({
        where: { id, organizationId: ctx.organizationId },
        select: { reconciledAt: true, voidedAt: true },
      });
      if (!existing) return { error: "Transaction not found." };
      if (existing.reconciledAt) return {};
      if (existing.voidedAt) return { error: "Voided transactions can't be reconciled." };
      const updated = await ctx.db.transaction.update({
        where: { id },
        data: {
          reconciledAt: new Date(),
          reconciledById: ctx.userId,
          statementRef: statementRef?.trim() || null,
        },
      });
      await writeFinanceAuditLog(ctx.db, {
        organizationId: ctx.organizationId,
        transactionId: id,
        action: "RECONCILE",
        before: { reconciledAt: null },
        after: { reconciledAt: updated.reconciledAt, statementRef: updated.statementRef },
      });
      return { transactionId: id };
    });
  },
);

export const reconcileTransaction = financeAction(
  async (ctx, transactionId: string, statementRef?: string): Promise<ActionResult> => {
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

export const unlockTransaction = financeAction(
  async (ctx, transactionId: string, reason?: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");

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
      after: { reconciledAt: updated.reconciledAt, reason: reason?.trim() || null },
    });

    return { transactionId };
  },
);
