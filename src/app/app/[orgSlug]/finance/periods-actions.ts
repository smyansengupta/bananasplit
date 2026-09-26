"use server";

import { z } from "zod";

import { requirePermission } from "@/lib/auth/permissions";
import { withOrgAction } from "@/server/db/context";

/**
 * Budget periods and categories (0C). These used to call
 * requireFinanceAccess directly; each now runs in one withOrgAction
 * transaction as app_user, checks finance.manage (OWNER or TREASURER; a
 * ForbiddenError otherwise, as before), and RLS allows the writes only to
 * OWNER/TREASURER of the org (policy 6.9).
 *
 * Error semantics: every action returns its { error } before any write
 * (case a). createBudgetPeriod and setActivePeriod used a nested
 * $transaction; the wrapper's transaction now covers their reads and writes.
 */

interface ActionResult {
  error?: string;
  periodId?: string;
}

const periodInputSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(100),
  startsOn: z.string(),
  endsOn: z.string(),
});

const DEFAULT_CATEGORY_NAMES = ["Food", "Materials", "Travel", "Marketing", "Speaker Fees"];

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
    const data = parsed.data;

    const startsOn = new Date(data.startsOn);
    const endsOn = new Date(data.endsOn);
    if (endsOn <= startsOn) {
      return { error: "End date must be after the start date." };
    }

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
        label: data.label,
        startsOn,
        endsOn,
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
  name: z.string().trim().min(1, "Name is required").max(100),
  allocatedCents: z.number().int().min(0),
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

export const deleteCategory = withOrgAction(
  async (ctx, categoryId: string): Promise<ActionResult> => {
    requirePermission(ctx, "finance.manage");
    const organizationId = ctx.organizationId;

    const category = await ctx.db.budgetCategory.findFirst({
      where: { id: categoryId, organizationId },
    });
    if (!category) return { error: "Category not found." };

    const usedByTransaction = await ctx.db.transaction.findFirst({
      where: { organizationId, categoryId },
      select: { id: true },
    });
    if (usedByTransaction) {
      return { error: "This category has transactions against it and can't be deleted." };
    }

    await ctx.db.budgetCategory.delete({ where: { id: categoryId } });
    return {};
  },
);
