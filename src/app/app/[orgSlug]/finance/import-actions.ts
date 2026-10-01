"use server";

import { can } from "@/lib/auth/permissions";
import { withOrgAction } from "@/server/db/context";
import {
  budgetLinesSchema,
  duplicateKeysSchema,
  findDuplicates,
  importBudgetLines,
  importInputSchema,
  importRecords,
  undoImport,
  type ImportOutcome,
} from "@/server/finance/import";

/**
 * Finance imports (src/server/finance/import.ts does the work). Owners and
 * treasurers only: the check here gives the message, the BudgetPeriod and
 * Transaction policies enforce it. Each call is one transaction; a big
 * import arrives as several calls sharing one batch id.
 */

const NOT_FINANCE = { error: "Only the club's owners and treasurers can import finance records." };

export const importFinanceRecords = withOrgAction(
  async (ctx, input: unknown): Promise<{ error?: string; outcome?: ImportOutcome }> => {
    if (!can(ctx, "finance.manage")) return NOT_FINANCE;
    const parsed = importInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const row = typeof issue?.path[1] === "number" ? ` (row ${issue.path[1] + 1} of this part)` : "";
      return { error: `${issue?.message ?? "Some rows couldn't be read."}${row}` };
    }
    return { outcome: await importRecords(ctx, parsed.data) };
  },
);

export const undoFinanceImport = withOrgAction(
  async (ctx, batch: string): Promise<{ error?: string; removed?: number }> => {
    if (!can(ctx, "finance.manage")) return NOT_FINANCE;
    if (!/^[a-z0-9]{8,40}$/.test(batch)) return { error: "That import can't be found." };
    return undoImport(ctx, batch);
  },
);

export const importFinanceBudget = withOrgAction(
  async (ctx, input: unknown): Promise<{ error?: string; updated?: number; created?: number; periodLabel?: string }> => {
    if (!can(ctx, "finance.manage")) return NOT_FINANCE;
    const parsed = budgetLinesSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Some budget lines couldn't be read." };
    return importBudgetLines(ctx, parsed.data);
  },
);

export const checkImportDuplicates = withOrgAction(
  async (ctx, keys: unknown): Promise<{ error?: string; duplicates?: string[] }> => {
    if (!can(ctx, "finance.manage")) return NOT_FINANCE;
    const parsed = duplicateKeysSchema.safeParse(keys);
    if (!parsed.success) return { duplicates: [] };
    return { duplicates: await findDuplicates(ctx, parsed.data) };
  },
);
