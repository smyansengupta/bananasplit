-- Budgets are finance's too. 20261028170000_finance_for_finance_roles left
-- BudgetCategory readable by every member, so a member could read each
-- category's allocated amount; now only the owner, admins and treasurers
-- (app.is_finance) read the rows.
--
-- A member still files an expense under a category: app.expense_categories
-- hands them the category list of their org without the amounts (id, period,
-- name, order), for the expense form and the check that a category is in the
-- expense's period. BudgetPeriod stays readable (a label and dates, no money).
-- Writes were finance-only already, and the same-org triggers and foreign
-- keys on Transaction.categoryId don't read through these policies.

DROP POLICY app_user_select ON "BudgetCategory";
CREATE POLICY app_user_select ON "BudgetCategory" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));

CREATE FUNCTION app.expense_categories()
RETURNS TABLE ("id" text, "budgetPeriodId" text, "name" text, "sortOrder" integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c."id", c."budgetPeriodId", c."name", c."sortOrder"
    FROM public."BudgetCategory" c
   WHERE c."organizationId" = app.member_org_id()
   ORDER BY c."sortOrder", c."name"
$$;
REVOKE ALL ON FUNCTION app.expense_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expense_categories() TO app_user;
