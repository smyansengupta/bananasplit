import { z } from "zod";

import { TransactionStatus, type Prisma } from "@/generated/prisma/client";
import { IMPORT_KINDS } from "@/lib/ai/finance-sheet";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import { DELETED_TRANSACTION_REASON } from "@/lib/finance/deleted";
import { kindFits } from "@/lib/finance/import/mapping";
import { planPeriods, type PeriodLike } from "@/lib/finance/import/plan";
import { MAX_IMPORT_CENTS } from "@/lib/finance/import/values";
import { fromDateValue, toDateValue } from "@/lib/finance/periods";
import { writeOrgAuditLog } from "@/server/audit";
import type { OrgContext } from "@/server/db/context";

import { ensureActivePeriod } from "./periods";

/**
 * Past records into the ledger, in one transaction as app_user (so the
 * Transaction and BudgetPeriod policies apply: only OWNER/TREASURER write).
 * Each row lands in the period covering its date (src/lib/finance/import/
 * plan.ts); dates no period covers get new, inactive periods when asked;
 * category names become the period's categories, created at $0 when
 * missing. Rows go in as the importer's, money that already moved: an
 * expense is NOT_APPLICABLE (nobody is owed it), everything else as is.
 *
 * Every row gets a finance audit entry (action IMPORT, tagged with the
 * import's batch id), which is also how undoImport finds them again. One
 * org audit row records the counts, never the content.
 */

export const MAX_IMPORT_ROWS_PER_CALL = 1000;

export const importRecordSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date is missing."),
  description: z.string().trim().min(1).max(500),
  amountCents: z.number().int().positive().max(MAX_IMPORT_CENTS),
  direction: z.enum(["IN", "OUT"]),
  kind: z.enum(IMPORT_KINDS),
  category: z.string().trim().max(100).nullable(),
  counterparty: z.string().trim().max(200).nullable(),
  paymentMethod: z.string().trim().max(100).nullable(),
});

export const importInputSchema = z.object({
  /** One id for every call of one import (a big file arrives in parts). */
  batch: z.string().regex(/^[a-z0-9]{8,40}$/),
  /** The file's name, for the audit trail and the reconciliation note. */
  source: z.string().trim().max(120),
  records: z.array(importRecordSchema).min(1).max(MAX_IMPORT_ROWS_PER_CALL),
  createPeriods: z.boolean(),
  createCategories: z.boolean(),
  reconciled: z.boolean(),
});
export type ImportInput = z.infer<typeof importInputSchema>;

export interface ImportOutcome {
  created: number;
  skipped: { index: number; reason: string }[];
  periods: { label: string; created: boolean; count: number }[];
  categoriesCreated: string[];
}

export async function importRecords(ctx: OrgContext, input: ImportInput, now: Date = new Date()): Promise<ImportOutcome> {
  const { db, organizationId } = ctx;
  const skipped: ImportOutcome["skipped"] = [];
  const records = input.records.flatMap((r, index) => {
    const day = fromDateValue(r.date);
    if (!day) {
      skipped.push({ index, reason: "The date isn't a real day." });
      return [];
    }
    if (!kindFits(r.kind, r.direction)) {
      skipped.push({ index, reason: "That type doesn't match the money's direction." });
      return [];
    }
    return [{ ...r, index, day }];
  });

  const active = await db.budgetPeriod.findFirst({ where: { organizationId, isActive: true }, select: { id: true } });
  if (!active) await ensureActivePeriod(db, organizationId, now);
  const loadPeriods = async (): Promise<PeriodLike[]> =>
    (await db.budgetPeriod.findMany({ where: { organizationId } })).map((p) => ({
      id: p.id,
      label: p.label,
      startsOn: toDateValue(p.startsOn),
      endsOn: toDateValue(p.endsOn),
      isActive: p.isActive,
    }));
  let periods = await loadPeriods();

  const plan = planPeriods(
    periods,
    records.map((r) => r.date),
  );
  const createdPeriodIds = new Set<string>();
  const draftIds = new Map<string, string>();
  if (input.createPeriods) {
    for (const draft of plan.drafts) {
      const created = await db.budgetPeriod.create({
        data: {
          organizationId,
          label: draft.label,
          startsOn: fromDateValue(draft.startsOn)!,
          endsOn: fromDateValue(draft.endsOn)!,
          isActive: false,
        },
        select: { id: true },
      });
      draftIds.set(`${draft.startsOn}|${draft.endsOn}`, created.id);
      createdPeriodIds.add(created.id);
    }
    if (plan.drafts.length > 0) periods = await loadPeriods();
  }

  const periodOf = (date: string): string | null => {
    const target = plan.targets.get(date);
    if (!target) return null;
    if ("existing" in target) return target.existing;
    return draftIds.get(`${target.draft.startsOn}|${target.draft.endsOn}`) ?? null;
  };

  // Categories by period, by lowercase name; missing ones made at $0.
  const periodIds = [...new Set(records.map((r) => periodOf(r.date)).filter((id): id is string => id !== null))];
  const existing = await db.budgetCategory.findMany({
    where: { organizationId, budgetPeriodId: { in: periodIds } },
    select: { id: true, name: true, budgetPeriodId: true, sortOrder: true },
  });
  const categories = new Map<string, Map<string, string>>();
  const nextSort = new Map<string, number>();
  for (const c of existing) {
    const byName = categories.get(c.budgetPeriodId) ?? new Map<string, string>();
    byName.set(c.name.trim().toLowerCase(), c.id);
    categories.set(c.budgetPeriodId, byName);
    nextSort.set(c.budgetPeriodId, Math.max(nextSort.get(c.budgetPeriodId) ?? 0, c.sortOrder + 1));
  }
  const categoriesCreated: string[] = [];
  const categoryOf = async (periodId: string, name: string | null): Promise<string | null> => {
    const clean = name?.trim();
    if (!clean) return null;
    const byName = categories.get(periodId) ?? new Map<string, string>();
    categories.set(periodId, byName);
    const found = byName.get(clean.toLowerCase());
    if (found || !input.createCategories) return found ?? null;
    const sortOrder = nextSort.get(periodId) ?? 0;
    const created = await db.budgetCategory.create({
      data: { organizationId, budgetPeriodId: periodId, name: clean, allocatedCents: 0, sortOrder },
      select: { id: true },
    });
    nextSort.set(periodId, sortOrder + 1);
    byName.set(clean.toLowerCase(), created.id);
    if (!categoriesCreated.some((n) => n.toLowerCase() === clean.toLowerCase())) categoriesCreated.push(clean);
    return created.id;
  };

  const data: Prisma.TransactionCreateManyInput[] = [];
  const counts = new Map<string, number>();
  const statementRef = input.reconciled ? `Imported from ${input.source || "a spreadsheet"}`.slice(0, 200) : null;
  for (const r of records) {
    const periodId = periodOf(r.date);
    if (!periodId) {
      skipped.push({ index: r.index, reason: `No budget period covers ${r.date}.` });
      continue;
    }
    data.push({
      organizationId,
      budgetPeriodId: periodId,
      categoryId: await categoryOf(periodId, r.category),
      direction: r.direction,
      kind: r.kind,
      amountCents: r.amountCents,
      description: r.description,
      counterparty: r.counterparty || null,
      paymentMethod: r.paymentMethod || null,
      occurredAt: r.day,
      submittedById: ctx.userId,
      // Money that already moved: nobody is owed an imported expense.
      status: TransactionStatus.NOT_APPLICABLE,
      ...(input.reconciled ? { reconciledAt: now, reconciledById: ctx.userId, statementRef } : {}),
    });
    counts.set(periodId, (counts.get(periodId) ?? 0) + 1);
  }

  const created = data.length
    ? await db.transaction.createManyAndReturn({ data, select: { id: true } })
    : [];
  const ids = created.map((t) => t.id);
  if (ids.length > 0) {
    // One statement writes every row's audit entry (the function checks the org and the actor).
    await db.$queryRaw`
      SELECT app.write_finance_audit(${organizationId}, 'IMPORT', t.id, NULL,
        jsonb_build_object('batch', ${input.batch}::text, 'before', NULL, 'after', to_jsonb(t)))
      FROM "Transaction" t
      WHERE t."organizationId" = ${organizationId} AND t.id = ANY(${ids}::text[])`;
    await writeOrgAuditLog(db, {
      organizationId,
      action: "finance.records_imported",
      targetType: "Organization",
      targetId: organizationId,
      diff: {
        batch: input.batch,
        created: ids.length,
        skipped: skipped.length,
        periodsCreated: createdPeriodIds.size,
        categoriesCreated: categoriesCreated.length,
        reconciled: input.reconciled,
      },
    });
  }

  const labelOf = new Map(periods.map((p) => [p.id, p.label]));
  return {
    created: ids.length,
    skipped: skipped.sort((a, b) => a.index - b.index),
    periods: [...counts.entries()].map(([id, count]) => ({
      label: labelOf.get(id) ?? "",
      created: createdPeriodIds.has(id),
      count,
    })),
    categoriesCreated,
  };
}

/**
 * Takes an import back out: every transaction it created is deleted the
 * usual way (voided as "Deleted", each audited), unlocking any that were
 * imported as reconciled first. Periods and categories it made stay.
 */
export async function undoImport(ctx: OrgContext, batch: string): Promise<{ removed: number }> {
  const { db, organizationId } = ctx;
  const entries = await db.financeAuditLog.findMany({
    where: { organizationId, action: "IMPORT", diffJson: { path: ["batch"], equals: batch } },
    select: { transactionId: true },
  });
  const ids = [...new Set(entries.map((e) => e.transactionId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return { removed: 0 };
  const rows = await db.transaction.findMany({ where: { organizationId, id: { in: ids }, voidedAt: null } });
  for (const row of rows) {
    const updated = await db.transaction.update({
      where: { id: row.id },
      data: {
        voidedAt: new Date(),
        voidReason: DELETED_TRANSACTION_REASON,
        ...(row.reconciledAt ? { reconciledAt: null, reconciledById: null, statementRef: null } : {}),
      },
    });
    await writeFinanceAuditLog(db, {
      organizationId,
      transactionId: row.id,
      action: "VOID",
      before: row,
      after: { ...updated, reason: "import undone" },
    });
  }
  if (rows.length > 0) {
    await writeOrgAuditLog(db, {
      organizationId,
      action: "finance.import_undone",
      targetType: "Organization",
      targetId: organizationId,
      diff: { batch, removed: rows.length },
    });
  }
  return { removed: rows.length };
}

export const budgetLinesSchema = z.object({
  /** Empty: the active period. */
  periodId: z.string().max(40).nullable(),
  lines: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(100),
        allocatedCents: z.number().int().min(0).max(1_000_000_000),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * A budget sheet's lines onto a period: a category with the same name
 * (any case) gets the new amount, the rest are added after the existing ones.
 */
export async function importBudgetLines(
  ctx: OrgContext,
  input: z.infer<typeof budgetLinesSchema>,
): Promise<{ updated: number; created: number; periodLabel: string } | { error: string }> {
  const { db, organizationId } = ctx;
  const period = input.periodId
    ? await db.budgetPeriod.findFirst({ where: { id: input.periodId, organizationId }, select: { id: true, label: true } })
    : await ensureActivePeriod(db, organizationId);
  if (!period) return { error: "Budget period not found." };
  const existing = await db.budgetCategory.findMany({
    where: { organizationId, budgetPeriodId: period.id },
    select: { id: true, name: true, sortOrder: true },
  });
  const byName = new Map(existing.map((c) => [c.name.trim().toLowerCase(), c]));
  let sortOrder = existing.reduce((m, c) => Math.max(m, c.sortOrder + 1), 0);
  let updated = 0;
  let created = 0;
  for (const line of input.lines) {
    const match = byName.get(line.name.toLowerCase());
    if (match) {
      await db.budgetCategory.update({ where: { id: match.id }, data: { allocatedCents: line.allocatedCents } });
      updated++;
    } else {
      const row = await db.budgetCategory.create({
        data: { organizationId, budgetPeriodId: period.id, name: line.name, allocatedCents: line.allocatedCents, sortOrder: sortOrder++ },
        select: { id: true, name: true, sortOrder: true },
      });
      byName.set(line.name.toLowerCase(), row);
      created++;
    }
  }
  await writeOrgAuditLog(db, {
    organizationId,
    action: "finance.budget_imported",
    targetType: "BudgetPeriod",
    targetId: period.id,
    diff: { updated, created },
  });
  return { updated, created, periodLabel: period.label };
}

export interface DuplicateKey {
  date: string;
  amountCents: number;
  direction: "IN" | "OUT";
}

export const duplicateKeysSchema = z
  .array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amountCents: z.number().int().positive().max(MAX_IMPORT_CENTS),
      direction: z.enum(["IN", "OUT"]),
    }),
  )
  .max(5000);

export const duplicateKey = (k: DuplicateKey) => `${k.date}|${k.amountCents}|${k.direction}`;

/**
 * Which proposed rows match a transaction already in the books (same day,
 * amount and direction, not deleted): the review unticks those, so
 * importing the same export twice doesn't double the money.
 */
export async function findDuplicates(ctx: OrgContext, keys: readonly DuplicateKey[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const dates = keys.map((k) => k.date).sort();
  const from = fromDateValue(dates[0]);
  const to = fromDateValue(dates[dates.length - 1]);
  if (!from || !to) return [];
  const rows = await ctx.db.transaction.findMany({
    where: {
      organizationId: ctx.organizationId,
      occurredAt: { gte: from, lt: new Date(to.getTime() + 86_400_000) },
      amountCents: { in: [...new Set(keys.map((k) => k.amountCents))] },
      OR: [{ voidReason: null }, { voidReason: { not: DELETED_TRANSACTION_REASON } }],
    },
    select: { occurredAt: true, amountCents: true, direction: true },
    take: 20_000,
  });
  const found = new Set(rows.map((r) => duplicateKey({ date: toDateValue(r.occurredAt), amountCents: r.amountCents, direction: r.direction })));
  return [...new Set(keys.map(duplicateKey))].filter((k) => found.has(k));
}

