"use server";

import { z } from "zod";

import { TransactionDirection, TransactionKind, TransactionStatus } from "@/generated/prisma/client";
import { can } from "@/lib/auth/permissions";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { DELETED_TRANSACTION_REASON } from "@/lib/finance/deleted";
import { fromDateValue } from "@/lib/finance/periods";
import { STARTING_BALANCE_DESCRIPTION } from "@/lib/finance/setup";
import { withOrgAction } from "@/server/db/context";
import { ensureActivePeriod } from "@/server/finance/periods";
import { findStartingBalance } from "@/server/finance/setup";

/**
 * The finance setup guide's own writes (the period, treasurers and the
 * dashboard reuse the ordinary actions). Owners and treasurers only; the
 * BudgetCategory and Transaction policies enforce the same.
 */

const NOT_FINANCE = { error: "Only the club's owners and treasurers can set up finance." };

const balanceSchema = z.object({
  /** Signed: negative when the club starts in debt. Zero removes it. */
  cents: z.number().int().min(-1_000_000_000).max(1_000_000_000),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date that balance was true."),
});

/**
 * Records what the club has when it starts tracking, as one adjustment in
 * the active period ("Starting balance"), so the balance is right from day
 * one. It is reconciled (it came from the bank, and the 60-day reminder
 * shouldn't flag it) and this action is the only thing that changes it:
 * again with a new amount, or to zero to take it out.
 */
export const setStartingBalance = withOrgAction(
  async (ctx, input: unknown): Promise<{ error?: string; transactionId?: string | null }> => {
    if (!can(ctx, "finance.manage")) return NOT_FINANCE;
    const parsed = balanceSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Enter an amount." };
    const day = fromDateValue(parsed.data.asOf);
    if (!day) return { error: "Pick the date that balance was true." };
    const { cents } = parsed.data;
    const organizationId = ctx.organizationId;
    const period = await ensureActivePeriod(ctx.db, organizationId);
    const existing = await findStartingBalance(ctx.db, organizationId, period.id);
    const now = new Date();

    if (cents === 0) {
      if (!existing) return { transactionId: null };
      const removed = await ctx.db.transaction.update({
        where: { id: existing.id },
        data: { voidedAt: now, voidReason: DELETED_TRANSACTION_REASON, reconciledAt: null, reconciledById: null, statementRef: null },
      });
      await writeFinanceAuditLog(ctx.db, {
        organizationId,
        transactionId: existing.id,
        action: "VOID",
        before: existing,
        after: removed,
      });
      return { transactionId: null };
    }

    const values = {
      direction: cents > 0 ? TransactionDirection.IN : TransactionDirection.OUT,
      amountCents: Math.abs(cents),
      occurredAt: day,
      reconciledAt: now,
      reconciledById: ctx.userId,
      statementRef: STARTING_BALANCE_DESCRIPTION,
    };
    if (existing) {
      const updated = await ctx.db.transaction.update({ where: { id: existing.id }, data: values });
      await writeFinanceAuditLog(ctx.db, {
        organizationId,
        transactionId: existing.id,
        action: "UPDATE",
        before: existing,
        after: updated,
      });
      return { transactionId: existing.id };
    }
    const created = await ctx.db.transaction.create({
      data: {
        organizationId,
        budgetPeriodId: period.id,
        kind: TransactionKind.ADJUSTMENT,
        description: STARTING_BALANCE_DESCRIPTION,
        status: TransactionStatus.NOT_APPLICABLE,
        submittedById: ctx.userId,
        ...values,
      },
    });
    await writeFinanceAuditLog(ctx.db, { organizationId, transactionId: created.id, action: "CREATE", after: created });
    return { transactionId: created.id };
  },
);

const linesSchema = z
  .array(
    z.object({
      id: z.string().max(40).nullable(),
      name: z.string().trim().min(1, "Give every budget line a name.").max(100),
      allocatedCents: z.number().int().min(0).max(1_000_000_000),
    }),
  )
  .max(100);

/**
 * The budget step's list, saved at once: existing lines are renamed and
 * re-budgeted, new ones added, and lines left out are removed when no
 * transaction uses them (one that's in use is kept, and counted).
 */
export const saveBudgetLines = withOrgAction(
  async (ctx, periodId: string, input: unknown): Promise<{ error?: string; kept?: number }> => {
    if (!can(ctx, "finance.manage")) return NOT_FINANCE;
    const parsed = linesSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the budget lines." };
    const names = parsed.data.map((l) => l.name.toLowerCase());
    if (new Set(names).size !== names.length) return { error: "Two budget lines have the same name." };
    const organizationId = ctx.organizationId;
    const period = await ctx.db.budgetPeriod.findFirst({ where: { id: periodId, organizationId }, select: { id: true } });
    if (!period) return { error: "Budget period not found." };

    const current = await ctx.db.budgetCategory.findMany({
      where: { organizationId, budgetPeriodId: period.id },
      select: { id: true },
    });
    const currentIds = new Set(current.map((c) => c.id));
    const keep = new Set(parsed.data.flatMap((l) => (l.id && currentIds.has(l.id) ? [l.id] : [])));

    let kept = 0;
    for (const c of current) {
      if (keep.has(c.id)) continue;
      const used = await ctx.db.transaction.count({ where: { organizationId, categoryId: c.id } });
      if (used > 0) {
        kept++;
        continue;
      }
      await ctx.db.budgetCategory.delete({ where: { id: c.id } });
    }
    for (const [i, line] of parsed.data.entries()) {
      if (line.id && keep.has(line.id)) {
        await ctx.db.budgetCategory.update({
          where: { id: line.id },
          data: { name: line.name, allocatedCents: line.allocatedCents, sortOrder: i },
        });
      } else {
        await ctx.db.budgetCategory.create({
          data: { organizationId, budgetPeriodId: period.id, name: line.name, allocatedCents: line.allocatedCents, sortOrder: i },
          select: { id: true },
        });
      }
    }
    return { kept };
  },
);
