-- A member fixes a rejected expense request and sends it again
-- (reimbursement-state-machine.ts: RESUBMIT, REJECTED -> SUBMITTED).
--
-- The update policy kept submitters to their own DRAFT and SUBMITTED rows,
-- so a rejected request was final and had to be typed again from scratch.
-- USING now also admits the submitter's own REJECTED expense; WITH CHECK is
-- unchanged, so the row they write must still be an open expense
-- (DRAFT, SUBMITTED or NOT_APPLICABLE) with no approver, no payout and no
-- reconciliation. Finance roles are unaffected, and transaction_guard still
-- stops anyone approving, rejecting or paying their own expense.
DROP POLICY app_user_update ON "Transaction";
CREATE POLICY app_user_update ON "Transaction" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_finance())
              OR ("submittedById" = (SELECT app.user_id())
                  AND "status" IN ('DRAFT', 'SUBMITTED', 'REJECTED'))))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("approvedById" IS NULL OR "approvedById" <> "submittedById")
              AND ((SELECT app.is_finance())
                   OR ("submittedById" = (SELECT app.user_id()) AND "kind" = 'EXPENSE'
                       AND "status" IN ('DRAFT', 'SUBMITTED', 'NOT_APPLICABLE')
                       AND "approvedById" IS NULL AND "reimbursedAt" IS NULL AND "reconciledAt" IS NULL)));
