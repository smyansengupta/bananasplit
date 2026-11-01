-- A new budget period opens with the last one's closing balance
-- (periods-actions.ts createBudgetPeriod). Stored on the period, not as a
-- transaction: money rows can never be deleted, and a period holding one
-- could not be deleted if it was made by mistake. The BudgetPeriod policies
-- (finance roles only) already cover the new column.
ALTER TABLE "BudgetPeriod" ADD COLUMN "carriedInCents" INTEGER NOT NULL DEFAULT 0;
