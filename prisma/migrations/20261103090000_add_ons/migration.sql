-- Forms and Finance become add-ons an organization adds when it wants them
-- (src/lib/addons.ts). Organizations already using one keep it: Forms for
-- any organization with a form or quick poll, Finance for any with a budget
-- period or a transaction. Everyone else starts with neither.

ALTER TABLE "OrgSettings" ADD COLUMN "addOns" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "OrgSettings" s
   SET "addOns" = array_remove(ARRAY[
     CASE WHEN EXISTS (SELECT 1 FROM "Form" f WHERE f."organizationId" = s."organizationId")
          THEN 'forms' END,
     CASE WHEN EXISTS (SELECT 1 FROM "BudgetPeriod" b WHERE b."organizationId" = s."organizationId")
            OR EXISTS (SELECT 1 FROM "Transaction" t WHERE t."organizationId" = s."organizationId")
          THEN 'finance' END
   ]::TEXT[], NULL);
