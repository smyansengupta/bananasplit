import { DEFAULT_CATEGORY_NAMES } from "@/lib/finance/default-categories";
import { fromDateValue, schoolYear } from "@/lib/finance/periods";
import type { TxClient } from "@/server/db/context";

/**
 * The period money goes into when nobody picked one. Finance must never
 * dead-end on "create a budget period first": recording the first
 * transaction (or setting up the budget with one click) calls this, and it
 *
 * 1. returns the active period, or
 * 2. activates the period that covers today (or else the latest one), or
 * 3. creates this school year (Aug 1 – Jul 31) with the starter categories
 *    and makes it active.
 *
 * Runs inside the caller's transaction as app_user; the BudgetPeriod
 * policies let only OWNER/TREASURER write, so call it for them only.
 */
export async function ensureActivePeriod(
  db: TxClient,
  organizationId: string,
  today: Date = new Date(),
): Promise<{ id: string; label: string; created: boolean }> {
  const active = await db.budgetPeriod.findFirst({
    where: { organizationId, isActive: true },
    select: { id: true, label: true },
  });
  if (active) return { ...active, created: false };

  const day = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const existing =
    (await db.budgetPeriod.findFirst({
      where: { organizationId, startsOn: { lte: day }, endsOn: { gte: day } },
      orderBy: { startsOn: "desc" },
      select: { id: true, label: true },
    })) ??
    (await db.budgetPeriod.findFirst({
      where: { organizationId },
      orderBy: { endsOn: "desc" },
      select: { id: true, label: true },
    }));
  if (existing) {
    await db.budgetPeriod.update({ where: { id: existing.id }, data: { isActive: true } });
    return { ...existing, created: false };
  }

  const draft = schoolYear(today);
  const created = await db.budgetPeriod.create({
    data: {
      organizationId,
      label: draft.label,
      startsOn: fromDateValue(draft.startsOn)!,
      endsOn: fromDateValue(draft.endsOn)!,
      isActive: true,
      categories: {
        create: DEFAULT_CATEGORY_NAMES.map((name, i) => ({
          organizationId,
          name,
          allocatedCents: 0,
          sortOrder: i,
        })),
      },
    },
    select: { id: true, label: true },
  });
  return { ...created, created: true };
}
