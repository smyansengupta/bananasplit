-- Two fixes to who may delete a database (20261103130000_database_delete):
--
--   A form in the trash no longer holds its database: it is deleted with
--   it (Form cascades from the definition), as the app already counts it.
--
--   An admin may delete an owner-only database (memberVisibility OWNER)
--   only if they're an owner, the same as opening it. Archiving one first
--   no longer gets around that.

DROP POLICY app_user_delete ON "DatabaseDefinition";

CREATE POLICY app_user_delete ON "DatabaseDefinition" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND "kind" = 'CUSTOM'
         AND NOT EXISTS (
           SELECT 1 FROM public."Form" f
            WHERE f."organizationId" = "DatabaseDefinition"."organizationId"
              AND f."databaseId" = "DatabaseDefinition"."id"
              AND f."deletedAt" IS NULL)
         AND (((SELECT app.is_org_admin())
               AND ((SELECT app.is_org_owner()) OR "memberVisibility" <> 'OWNER'))
              OR (EXISTS (
                    SELECT 1 FROM public."OrgSettings" s
                     WHERE s."organizationId" = "DatabaseDefinition"."organizationId"
                       AND s."memberCanDeleteDatabases")
                  AND app.can_edit_database("DatabaseDefinition"."id"))));
