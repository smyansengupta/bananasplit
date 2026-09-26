-- =====================================================================
-- B1 (Settings): only an OWNER changes who may see individual ballots.
-- =====================================================================
-- OrgSettings is OWNER/ADMIN-updatable under RLS (Privacy settings), but
-- ballotIndividualVisibility decides whether ADMINs themselves may read
-- who voted for what (app.can_view_ballot_rows): an ADMIN who could set
-- OWNER_AND_ADMINS would grant themselves the votes. The app checks
-- privacy.ballots (OWNER); this trigger enforces the same rule in the
-- database for app_user and app_service, like app.organization_guard.
-- SECURITY INVOKER: the owner (migrations, the seed, FK cascades) is exempt.
-- No table, grant or policy changes.

CREATE OR REPLACE FUNCTION app.org_settings_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('app_user', 'app_service') THEN
    RETURN NEW;
  END IF;
  IF NEW."ballotIndividualVisibility" IS DISTINCT FROM OLD."ballotIndividualVisibility"
     AND NOT coalesce(app.user_has_role(app.user_id(), OLD."organizationId", 'OWNER'), false) THEN
    RAISE EXCEPTION 'only an OWNER can change OrgSettings.ballotIndividualVisibility'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER org_settings_guard BEFORE UPDATE OF "ballotIndividualVisibility" ON "OrgSettings"
  FOR EACH ROW EXECUTE FUNCTION app.org_settings_guard();

REVOKE EXECUTE ON FUNCTION app.org_settings_guard() FROM PUBLIC;
