-- Deleting a database for good (docs/features/databases.md, "Your own
-- databases"). Until now a database could only be archived: app_user had
-- no DELETE on "DatabaseDefinition" at all. Now an organization's own
-- databases can be deleted, with their fields and rows (both cascade from
-- the definition), and the Admin panel decides whether members may:
--
--   OrgSettings.memberCanDeleteDatabases   off (the default): owners and
--                                          admins only. On: also members who
--                                          can edit that database's rows
--                                          (app.can_edit_database).
--
-- Never deletable this way: the built-in databases (any kind but CUSTOM)
-- and a form's response database (the Form row points at it and would go
-- with it; delete the form instead). Every org member reads "Form" and
-- "OrgSettings", so the policy's subqueries see the same rows for everyone.

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "memberCanDeleteDatabases" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Hand-written: the DELETE policy and its grant.
-- ---------------------------------------------------------------------------

CREATE POLICY app_user_delete ON "DatabaseDefinition" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND "kind" = 'CUSTOM'
         AND NOT EXISTS (
           SELECT 1 FROM public."Form" f
            WHERE f."organizationId" = "DatabaseDefinition"."organizationId"
              AND f."databaseId" = "DatabaseDefinition"."id")
         AND ((SELECT app.is_org_admin())
              OR (EXISTS (
                    SELECT 1 FROM public."OrgSettings" s
                     WHERE s."organizationId" = "DatabaseDefinition"."organizationId"
                       AND s."memberCanDeleteDatabases")
                  AND app.can_edit_database("DatabaseDefinition"."id"))));

GRANT DELETE ON "DatabaseDefinition" TO app_user;
