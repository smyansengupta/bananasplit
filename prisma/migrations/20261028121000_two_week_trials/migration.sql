-- Two-week trials for everyone (the Bananasplit business model, October 2026).
--
--   Every new organization gets 14 days of Team Advanced (was 30), and every
--   new account's Personal space gets 14 days of Personal Plus. No card is
--   asked for either; when the trial ends the space is on its free plan
--   (Team Free, Personal Free) until someone picks a paid one.
--
--   A Personal space's trial is plan FREE with a trialEndsAt: the app reads
--   it as Personal Plus until then (src/lib/billing/space.ts). OrgPlan gains
--   nothing, and the Organization_personal_plan check is unchanged.
--
-- app.organization_space_guard, restated from 20261019120000_moonstone_product_update:
--   INSERT, every role: a Personal space left at the column default (TRIAL)
--   takes FREE with no trial (unchanged); a trial without an end ends in
--   14 days (was 30).
--   INSERT, app roles: a club starts on its trial, ending within 14 days
--   (was 30); a Personal space starts on FREE (unchanged), and a trial it
--   starts with ends within 14 days (new).
--   UPDATE: unchanged. Existing trials keep the end they were given.
-- SECURITY INVOKER: it reads nothing but the row.

CREATE OR REPLACE FUNCTION app.organization_space_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."kind" = 'PERSONAL' AND NEW."plan" = 'TRIAL' THEN
      NEW."plan" := 'FREE';
      NEW."trialEndsAt" := NULL;
    END IF;
    IF NEW."plan" = 'TRIAL' AND NEW."trialEndsAt" IS NULL THEN
      NEW."trialEndsAt" := app.utc_now() + interval '14 days';
    END IF;
    IF current_user IN ('app_user', 'app_service') THEN
      IF NEW."kind" = 'CLUB' AND NEW."plan" <> 'TRIAL' THEN
        RAISE EXCEPTION 'a new club starts on its trial' USING ERRCODE = '42501';
      END IF;
      IF NEW."kind" = 'PERSONAL' AND NEW."plan" <> 'FREE' THEN
        RAISE EXCEPTION 'a new Personal space starts on Personal Free' USING ERRCODE = '42501';
      END IF;
      IF NEW."trialEndsAt" > app.utc_now() + interval '14 days 1 hour' THEN
        RAISE EXCEPTION 'a trial is 14 days' USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF current_user NOT IN ('app_user', 'app_service') THEN
    RETURN NEW;
  END IF;
  IF NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."personalOwnerId" IS DISTINCT FROM OLD."personalOwnerId" THEN
    RAISE EXCEPTION 'Organization.kind and personalOwnerId are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW."trialEndsAt" IS DISTINCT FROM OLD."trialEndsAt" THEN
    RAISE EXCEPTION 'Organization.trialEndsAt is immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW."plan" IS DISTINCT FROM OLD."plan" THEN
    IF NEW."kind" = 'PERSONAL' THEN
      IF NEW."plan" NOT IN ('FREE', 'PERSONAL_PLUS') THEN
        RAISE EXCEPTION 'a Personal space moves between Personal Free and Personal Plus' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW."plan" IN ('TRIAL', 'FREE', 'PERSONAL_PLUS') THEN
      RAISE EXCEPTION 'a club moves to Team or Team Advanced' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.organization_space_guard() FROM PUBLIC;
