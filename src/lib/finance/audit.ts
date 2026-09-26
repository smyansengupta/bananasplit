import type { Prisma } from "@/generated/prisma/client";

/**
 * FinanceAuditLog writer (spec 5.9). The table is append-only and has no
 * INSERT grant for any runtime role: rows arrive only through
 * app.write_finance_audit(), which fixes the id, the actor (app.user_id()),
 * the org (the caller's org) and createdAt, and bounds the action and diff
 * size (N5). Call it with the SAME transaction client as the mutation it
 * describes (ctx.db), so the entry commits or rolls back with it: a log entry
 * with no matching committed change is worse than no log at all.
 *
 * The diff is stored as { before, after }; values go through JSON.stringify,
 * so Dates become ISO strings, exactly as Prisma stored them before.
 */

export type FinanceAuditDb = Pick<Prisma.TransactionClient, "$queryRaw">;

export interface FinanceAuditEntry {
  organizationId: string;
  transactionId?: string | null;
  sponsorshipId?: string | null;
  /** e.g. "CREATE", "EXPENSE_APPROVE". [A-Za-z][A-Za-z0-9_.:-]{0,79} */
  action: string;
  before?: unknown;
  after?: unknown;
}

export async function writeFinanceAuditLog(
  db: FinanceAuditDb,
  entry: FinanceAuditEntry,
): Promise<string> {
  const diff = JSON.stringify({ before: entry.before ?? null, after: entry.after ?? null });
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT app.write_finance_audit(
      ${entry.organizationId}, ${entry.action}, ${entry.transactionId ?? null},
      ${entry.sponsorshipId ?? null}, ${diff}::jsonb
    ) AS id`;
  return rows[0]?.id ?? "";
}
