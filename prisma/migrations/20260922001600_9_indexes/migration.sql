-- =====================================================================
-- Phase 9: index additions named in the performance pass
-- =====================================================================
-- Foreign-key and sort columns that hot queries filter or join on and that
-- had no supporting index: the notes list (org, not deleted, newest first),
-- the finance category and audit-trail joins, and the per-period category
-- list. The (organizationId, deletedAt) notes index is subsumed by the new
-- three-column one. Generated DDL (prisma migrate diff), minus the spurious
-- Note.searchVector DROP DEFAULT Prisma emits for the generated column.
-- The Phase 9 builder re-checks these with EXPLAIN at the 10k-row volume.

-- DropIndex
DROP INDEX "Note_organizationId_deletedAt_idx";

-- CreateIndex
CREATE INDEX "BudgetCategory_budgetPeriodId_idx" ON "BudgetCategory"("budgetPeriodId");

-- CreateIndex
CREATE INDEX "FinanceAuditLog_transactionId_idx" ON "FinanceAuditLog"("transactionId");

-- CreateIndex
CREATE INDEX "Note_organizationId_deletedAt_updatedAt_idx" ON "Note"("organizationId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");
