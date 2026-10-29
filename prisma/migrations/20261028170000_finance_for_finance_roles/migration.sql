-- Finance is for the owner, admins and treasurers; a member sees only their
-- own expenses.
--
-- app.is_finance, restated from 20260922000400_0b_rls_roles_policies_triggers
-- with ADMIN: every finance policy asks it, so admins now read and manage
-- finance as owners and treasurers do.
--
-- Reads, which were open to every member of the org (the app hid the pages,
-- the database did not):
--   Transaction      finance, or the member's own (what they submitted).
--   FinanceAuditLog  finance only.
--   Sponsor, Sponsorship  finance only.
-- BudgetPeriod and BudgetCategory stay readable to members: a member picks
-- the period and category of the expense they submit.

CREATE OR REPLACE FUNCTION app.is_finance() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app.member_role() IN ('OWNER', 'ADMIN', 'TREASURER'), false) $$;

DROP POLICY app_user_select ON "Transaction";
CREATE POLICY app_user_select ON "Transaction" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_finance()) OR "submittedById" = (SELECT app.user_id())));

DROP POLICY app_user_select ON "FinanceAuditLog";
CREATE POLICY app_user_select ON "FinanceAuditLog" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));

DROP POLICY app_user_select ON "Sponsor";
CREATE POLICY app_user_select ON "Sponsor" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));

DROP POLICY app_user_select ON "Sponsorship";
CREATE POLICY app_user_select ON "Sponsorship" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));
