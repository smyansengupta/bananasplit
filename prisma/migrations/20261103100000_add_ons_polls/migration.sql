-- The add-ons backfill (20261103090000_add_ons) kept Forms for organizations
-- with a form, but quick polls are their own rows (Poll), so an organization
-- that only ever ran quick polls lost Forms. Give it back.

UPDATE "OrgSettings" s
   SET "addOns" = array_append(s."addOns", 'forms')
 WHERE NOT ('forms' = ANY (s."addOns"))
   AND EXISTS (SELECT 1 FROM "Poll" p WHERE p."organizationId" = s."organizationId");
