-- =====================================================================
-- B2 (Profiles): turning the calendar feed off
-- =====================================================================
-- The profile's calendar feed card has "Turn off feed", which must clear
-- the caller's ICS token hash so the old link stops working and the card
-- shows "No feed link yet". 0B ships app.set_ics_token_hash(p_hash), which
-- only accepts a sha256 digest, and app.ics_token_created_at(); nothing can
-- clear the hash. UserCredential stays unreachable for every tenant role,
-- so this is one more definer function in the same style:
--   - keyed on app.user_id(): a caller clears only its own row;
--   - refused without a user context, and for any session user but app_user
--     (app_legacy is not granted: the legacy settings/calendar page never
--     had a turn-off button, and Profiles moves the card off app_legacy);
--   - search_path pinned, EXECUTE for app_user only, never PUBLIC.
-- No schema change and no new table, so the GRANTS matrix is unchanged;
-- the function is added to the reviewed definer and EXECUTE lists
-- (prisma/rls/tests.mjs T27c/T27f) and tested in phases.mjs (P2-03..05).

CREATE OR REPLACE FUNCTION app.clear_ics_token_hash() RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user text := app.user_id();
  v_n integer;
BEGIN
  IF v_user IS NULL OR session_user <> 'app_user' THEN
    RAISE EXCEPTION 'clear_ics_token_hash: not permitted' USING ERRCODE = '42501';
  END IF;
  UPDATE public."UserCredential" c
     SET "icsTokenHash" = NULL, "icsTokenCreatedAt" = NULL, "updatedAt" = app.utc_now()
   WHERE c."userId" = v_user AND c."icsTokenHash" IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END $$;

REVOKE EXECUTE ON FUNCTION app.clear_ics_token_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.clear_ics_token_hash() TO app_user;
