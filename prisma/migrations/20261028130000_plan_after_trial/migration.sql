-- The plan after a trial (the Bananasplit business model, October 2026).
--
--   Every new organization starts on its 14-day trial of Team Advanced,
--   whichever plan the visitor clicked. Picking a plan during the trial no
--   longer ends it: the pick goes in Organization.planAfterTrial and starts
--   when the trial ends (src/lib/billing/space.ts reads an ended TRIAL as
--   planAfterTrial, else Team Free). After the trial a pick moves the plan
--   at once, as before.
--
--   Organization_plan_after_trial: only an organization, only one of its
--   priced plans.
--   app.organization_guard, restated from 20261013170000_personal_spaces_and_trials
--   with planAfterTrial among the OWNER-only columns.

ALTER TABLE "Organization" ADD COLUMN "planAfterTrial" "OrgPlan";

ALTER TABLE "Organization" ADD CONSTRAINT "Organization_plan_after_trial"
  CHECK ("planAfterTrial" IS NULL
         OR ("kind" = 'CLUB' AND "planAfterTrial" IN ('TEAM_FREE', 'CLUB', 'SOCIETY')));

CREATE OR REPLACE FUNCTION app.organization_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  k text;
BEGIN
  IF current_user NOT IN ('app_user', 'app_service') THEN
    RETURN NEW;
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'Organization.id is immutable' USING ERRCODE = '42501';
  END IF;
  FOREACH k IN ARRAY ARRAY['slug', 'deletedAt', 'deleteScheduledFor', 'plan', 'planAfterTrial'] LOOP
    IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k)
       AND NOT app.user_has_role(app.user_id(), OLD."id", 'OWNER') THEN
      RAISE EXCEPTION 'only an OWNER can change Organization.%', k USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
