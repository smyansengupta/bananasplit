-- CRM databases (docs/features/crm.md, "How it fits into Databases"):
-- People, Companies and each pipeline are DatabaseDefinitions of kinds
-- CRM_PEOPLE, CRM_COMPANIES and CRM_PIPELINE, whose rows live in the CRM's
-- typed tables and whose custom fields are DatabaseField rows (values in
-- each record's `custom` JSON, keyed by field id).
--
-- 1. CrmStage.key: a stable key for a ready-made stage, so a renamed
--    "Received" still books the Finance transaction.
-- 2. app.assert_custom_database: fields may now belong to the CRM's
--    databases too. Rows still belong only to club-made (CUSTOM) ones; the
--    CRM's rows are its own tables.
-- 3. CRM managers (CrmSettings.managerIds) shape the CRM's databases the
--    way owners and admins do: make a pipeline's database, rename it, and
--    add, edit and remove the CRM's custom fields. Everything else about
--    DatabaseDefinition and DatabaseField is unchanged.

-- AlterTable
ALTER TABLE "CrmStage" ADD COLUMN     "key" TEXT;

-- ---------------------------------------------------------------------------
-- Hand-written.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.assert_custom_database() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."DatabaseDefinition" d
     WHERE d."id" = NEW."databaseId" AND d."organizationId" = NEW."organizationId"
       AND (d."kind" = 'CUSTOM'
            OR (TG_TABLE_NAME = 'DatabaseField'
                AND d."kind" IN ('CRM_PEOPLE', 'CRM_COMPANIES', 'CRM_PIPELINE')))
  ) THEN
    RAISE EXCEPTION '%: not a club-made database', TG_TABLE_NAME USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.assert_custom_database() FROM PUBLIC;

-- Is this definition one of the CRM's, in the caller's member org? Runs as
-- the caller (who can read every definition of their org).
CREATE OR REPLACE FUNCTION app.is_crm_database(p_database text) RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."DatabaseDefinition" d
     WHERE d."id" = p_database
       AND d."organizationId" = (SELECT app.member_org_id())
       AND d."kind" IN ('CRM_PEOPLE', 'CRM_COMPANIES', 'CRM_PIPELINE'))
$$;
REVOKE ALL ON FUNCTION app.is_crm_database(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_crm_database(text) TO app_user;

-- DatabaseDefinition: owners and admins make and edit definitions, as
-- before; CRM managers make and edit the CRM's.
DROP POLICY app_user_insert ON "DatabaseDefinition";
CREATE POLICY app_user_insert ON "DatabaseDefinition" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ((SELECT app.is_org_admin())
                   OR ("kind" IN ('CRM_PEOPLE', 'CRM_COMPANIES', 'CRM_PIPELINE')
                       AND (SELECT app.is_crm_manager()))));
DROP POLICY app_user_update ON "DatabaseDefinition";
CREATE POLICY app_user_update ON "DatabaseDefinition" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_org_admin())
              OR ("kind" IN ('CRM_PEOPLE', 'CRM_COMPANIES', 'CRM_PIPELINE')
                  AND (SELECT app.is_crm_manager()))))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ((SELECT app.is_org_admin())
                   OR ("kind" IN ('CRM_PEOPLE', 'CRM_COMPANIES', 'CRM_PIPELINE')
                       AND (SELECT app.is_crm_manager()))));

-- DatabaseField: owners and admins shape any database; CRM managers the
-- CRM's.
DROP POLICY app_user_insert ON "DatabaseField";
CREATE POLICY app_user_insert ON "DatabaseField" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ((SELECT app.is_org_admin())
                   OR ((SELECT app.is_crm_manager()) AND app.is_crm_database("databaseId"))));
DROP POLICY app_user_update ON "DatabaseField";
CREATE POLICY app_user_update ON "DatabaseField" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_org_admin())
              OR ((SELECT app.is_crm_manager()) AND app.is_crm_database("databaseId"))))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ((SELECT app.is_org_admin())
                   OR ((SELECT app.is_crm_manager()) AND app.is_crm_database("databaseId"))));
DROP POLICY app_user_delete ON "DatabaseField";
CREATE POLICY app_user_delete ON "DatabaseField" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_org_admin())
              OR ((SELECT app.is_crm_manager()) AND app.is_crm_database("databaseId"))));
