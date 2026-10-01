"use server";

import { z } from "zod";

import { requirePermission } from "@/lib/auth/permissions";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { DEFAULT_CATEGORY_NAMES } from "@/lib/finance/default-categories";
import { fromDateValue } from "@/lib/finance/periods";
import { withOrgAction } from "@/server/db/context";
import { ensureActivePeriod } from "@/server/finance/periods";

/**
 * Budget periods and categories (0C). Each runs in one withOrgAction
 * transaction as app_user, checks finance.manage (OWNER or TREASURER; a
 * ForbiddenError otherwise), and RLS allows the writes only to
 * OWNER/TREASURER of the org (policy 6.9).
 *
 * Error semantics: every action returns its { error } before any write.
 */

interface ActionResult {
  error?: string;
  periodId?: string;
  /** deleteCategory: transactions that became uncategorized. */
  moved?: number;
}

const periodInputSchema = z.object({
  label: z.string().trim().min(1, "Give the period a name, like 2026–27.").max(100),
  startsOn: z.string(),
  endsOn: z.string(),
});

function parseRange(startsOnRaw: string, endsOnRaw: string): { startsOn: Date; endsOn: Date } | { error: string } {
  const startsOn = fromDateValue(startsOnRaw);
  const endsOn = fromDateValue(endsOnRaw);
  if (!startsOn) return { error: "Pick a start date." };
  if (!endsOn) return { error: "Pick an end date." };
  if (endsOn <= startsOn) return { error: "The end date must be after the start date." };
  return { startsOn, endsOn };
}

/**
 * Creates a new budget period and makes it the active one. Copies the
 * previous active period's categories with allocations zeroed out — the new
 * treasurer sets fresh numbers rather than inheriting last year's budget.
 */
export const createBudgetPeriod = withOrgAction(
  async (ctx, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;

    const parsed = periodInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }
    const range = parseRange(parsed.data.startsOn, parsed.data.endsOn);
    if ("error" in range) return range;

    const previousActive = await ctx.db.budgetPeriod.findFirst({
      where: { organizationId, isActive: true },
      include: { categories: { orderBy: { sortOrder: "asc" } } },
    });

    if (previousActive) {
      await ctx.db.budgetPeriod.update({
        where: { id: previousActive.id },
        data: { isActive: false },
      });
    }

    const categorySource = previousActive?.categories.length
      ? previousActive.categories.map((c) => ({ name: c.name, sortOrder: c.sortOrder }))
      : DEFAULT_CATEGORY_NAMES.map((name, i) => ({ name, sortOrder: i }));

    const period = await ctx.db.budgetPeriod.create({
      data: {
        organizationId,
        label: parsed.data.label,
        startsOn: range.startsOn,
        endsOn: range.endsOn,
        isActive: true,
        categories: {
          create: categorySource.map((c) => ({
            organizationId,
            name: c.name,
            allocatedCents: 0,
            sortOrder: c.sortOrder,
          })),
        },
      },
      select: { id: true },
    });

    return { periodId: period.id };
  },
);

/**
 * One click from an empty Finance page: this school year with the starter
 * categories (or the period the org already has, made active).
 */
export const startBudget = withOrgAction(async (ctx): Promise<ActionResult> => {
  requirePermission(ctx, "finance.manage");
  const period = await ensureActivePeriod(ctx.db, ctx.organizationId);
  return { periodId: period.id };
});

/** Renames a period or moves its dates. Transactions keep their period. */
export const updateBudgetPeriod = withOrgAction(
  async (ctx, periodId: string, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const period = await ctx.db.budgetPeriod.findFirst({
      where: { id: periodId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!period) return { error: "Budget period not found." };
    const parsed = periodInputSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const range = parseRange(parsed.data.startsOn, parsed.data.endsOn);
    if ("error" in range) return range;
    await ctx.db.budgetPeriod.update({
      where: { id: periodId },
      data: { label: parsed.data.label, startsOn: range.startsOn, endsOn: range.endsOn },
    });
    return { periodId };
  },
);

/**
 * Deletes a period that holds no money yet (no transactions or
 * sponsorships, voided ones included: the ledger keeps every row). Its
 * categories go with it. Deleting the active period activates the latest
 * remaining one.
 */
export const deleteBudgetPeriod = withOrgAction(
  async (ctx, periodId: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;
    const period = await ctx.db.budgetPeriod.findFirst({
      where: { id: periodId, organizationId },
      select: { id: true, isActive: true },
    });
    if (!period) return { error: "Budget period not found." };
    const transactions = await ctx.db.transaction.count({ where: { organizationId, budgetPeriodId: periodId } });
    const sponsorships = await ctx.db.sponsorship.count({ where: { organizationId, budgetPeriodId: periodId } });
    if (transactions > 0 || sponsorships > 0) {
      const what = [
        transactions > 0 ? `${transactions} transaction${transactions === 1 ? "" : "s"}` : null,
        sponsorships > 0 ? `${sponsorships} sponsorship${sponsorships === 1 ? "" : "s"}` : null,
      ]
        .filter(Boolean)
        .join(" and ");
      return { error: `This period has ${what}, so it stays for the records. Make another period active instead.` };
    }
    await ctx.db.budgetPeriod.delete({ where: { id: periodId } });
    if (period.isActive) {
      const next = await ctx.db.budgetPeriod.findFirst({
        where: { organizationId },
        orderBy: { endsOn: "desc" },
        select: { id: true },
      });
      if (next) await ctx.db.budgetPeriod.update({ where: { id: next.id }, data: { isActive: true } });
    }
    return {};
  },
);

export const setActivePeriod = withOrgAction(
  async (ctx, periodId: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;

    const period = await ctx.db.budgetPeriod.findFirst({ where: { id: periodId, organizationId } });
    if (!period) return { error: "Budget period not found." };

    await ctx.db.budgetPeriod.updateMany({
      where: { organizationId, isActive: true },
      data: { isActive: false },
    });
    await ctx.db.budgetPeriod.update({ where: { id: periodId }, data: { isActive: true } });
    return {};
  },
);

const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Give the category a name.").max(100),
  allocatedCents: z.number().int().min(0).max(1_000_000_000),
});

export const createCategory = withOrgAction(
  async (ctx, periodId: string, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;

    const period = await ctx.db.budgetPeriod.findFirst({ where: { id: periodId, organizationId } });
    if (!period) return { error: "Budget period not found." };

    const parsed = categoryInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    const count = await ctx.db.budgetCategory.count({
      where: { organizationId, budgetPeriodId: periodId },
    });
    await ctx.db.budgetCategory.create({
      data: {
        organizationId,
        budgetPeriodId: periodId,
        name: parsed.data.name,
        allocatedCents: parsed.data.allocatedCents,
        sortOrder: count,
      },
      select: { id: true },
    });
    return {};
  },
);

export const updateCategory = withOrgAction(
  async (ctx, categoryId: string, input: unknown): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");

    const category = await ctx.db.budgetCategory.findFirst({
      where: { id: categoryId, organizationId: ctx.organizationId },
    });
    if (!category) return { error: "Category not found." };

    const parsed = categoryInputSchema.partial().safeParse(input);
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    }

    await ctx.db.budgetCategory.update({
      where: { id: categoryId },
      data: { name: parsed.data.name, allocatedCents: parsed.data.allocatedCents },
    });
    return {};
  },
);

/**
 * Removes a category. Transactions filed under it become uncategorized (the
 * money stays in every total), each change in the finance audit log; a
 * reconciled transaction is locked, so one of those keeps the category.
 */
export const deleteCategory = withOrgAction(
  async (ctx, categoryId: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;

    const category = await ctx.db.budgetCategory.findFirst({
      where: { id: categoryId, organizationId },
    });
    if (!category) return { error: "Category not found." };

    const used = await ctx.db.transaction.findMany({
      where: { organizationId, categoryId },
      select: { id: true, reconciledAt: true },
    });
    const locked = used.filter((t) => t.reconciledAt).length;
    if (locked > 0) {
      return {
        error: `${locked} reconciled transaction${locked === 1 ? " is" : "s are"} filed under ${category.name}. Unlock ${locked === 1 ? "it" : "them"} first, or keep the category.`,
      };
    }
    for (const t of used) {
      await ctx.db.transaction.update({ where: { id: t.id }, data: { categoryId: null } });
      await writeFinanceAuditLog(ctx.db, {
        organizationId,
        transactionId: t.id,
        action: "UPDATE",
        before: { categoryId, categoryName: category.name },
        after: { categoryId: null, reason: "category deleted" },
      });
    }

    await ctx.db.budgetCategory.delete({ where: { id: categoryId } });
    return { moved: used.length };
  },
);
