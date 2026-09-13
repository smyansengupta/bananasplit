"use server";

import { z } from "zod";

import { requireFinanceAccess } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

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
export async function createBudgetPeriod(
  organizationId: string,
  input: unknown,
): Promise<ActionResult> {
  await requireFinanceAccess(organizationId);

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

  const previousActive = await prisma.budgetPeriod.findFirst({
    where: { organizationId, isActive: true },
    include: { categories: { orderBy: { sortOrder: "asc" } } },
  });

  const period = await prisma.$transaction(async (tx) => {
    if (previousActive) {
      await tx.budgetPeriod.update({
        where: { id: previousActive.id },
        data: { isActive: false },
      });
    }

    const categorySource = previousActive?.categories.length
      ? previousActive.categories.map((c) => ({ name: c.name, sortOrder: c.sortOrder }))
      : DEFAULT_CATEGORY_NAMES.map((name, i) => ({ name, sortOrder: i }));

    return tx.budgetPeriod.create({
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
    });
  });

  return { periodId: period.id };
}

export async function setActivePeriod(
  organizationId: string,
  periodId: string,
): Promise<ActionResult> {
  await requireFinanceAccess(organizationId);

  const period = await prisma.budgetPeriod.findFirst({ where: { id: periodId, organizationId } });
  if (!period) return { error: "Budget period not found." };

  await prisma.$transaction([
    prisma.budgetPeriod.updateMany({
      where: { organizationId, isActive: true },
      data: { isActive: false },
    }),
    prisma.budgetPeriod.update({ where: { id: periodId }, data: { isActive: true } }),
  ]);
  return {};
}

const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  allocatedCents: z.number().int().min(0),
});

export async function createCategory(
  organizationId: string,
  periodId: string,
  input: unknown,
): Promise<ActionResult> {
  await requireFinanceAccess(organizationId);

  const period = await prisma.budgetPeriod.findFirst({ where: { id: periodId, organizationId } });
  if (!period) return { error: "Budget period not found." };

  const parsed = categoryInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const count = await prisma.budgetCategory.count({ where: { budgetPeriodId: periodId } });
  await prisma.budgetCategory.create({
    data: {
      organizationId,
      budgetPeriodId: periodId,
      name: parsed.data.name,
      allocatedCents: parsed.data.allocatedCents,
      sortOrder: count,
    },
  });
  return {};
}

export async function updateCategory(
  organizationId: string,
  categoryId: string,
  input: unknown,
): Promise<ActionResult> {
  await requireFinanceAccess(organizationId);

  const category = await prisma.budgetCategory.findFirst({
    where: { id: categoryId, organizationId },
  });
  if (!category) return { error: "Category not found." };

  const parsed = categoryInputSchema.partial().safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await prisma.budgetCategory.update({
    where: { id: categoryId },
    data: { name: parsed.data.name, allocatedCents: parsed.data.allocatedCents },
  });
  return {};
}

export async function deleteCategory(
  organizationId: string,
  categoryId: string,
): Promise<ActionResult> {
  await requireFinanceAccess(organizationId);

  const category = await prisma.budgetCategory.findFirst({
    where: { id: categoryId, organizationId },
  });
  if (!category) return { error: "Category not found." };

  const usedByTransaction = await prisma.transaction.findFirst({ where: { categoryId } });
  if (usedByTransaction) {
    return { error: "This category has transactions against it and can't be deleted." };
  }

  await prisma.budgetCategory.delete({ where: { id: categoryId } });
  return {};
}
