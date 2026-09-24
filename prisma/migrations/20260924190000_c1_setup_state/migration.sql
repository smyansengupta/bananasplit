-- =====================================================================
-- C1 (guided setup): the two things the guided setup has to remember.
-- =====================================================================
-- Setup PROGRESS is derived on every read from the org's OrgIntegration
-- rows (status, lastVerifiedAt) and from DataSourceSyncState, so the flow
-- can never claim a service is connected when it is not. Only the two
-- choices a human makes are stored:
--
--   setupSkipped      step ids the org chose to pass over ("data",
--                     "calendar", "email", "claude"). Cleared for a step
--                     as soon as that integration connects.
--   setupCompletedAt  when someone finished or dismissed the flow. It only
--                     hides the prompt on the org overview; /setup and the
--                     connection status page stay reachable.
--
-- No new table, so no new policy and no new GRANT: both columns live on
-- OrgSettings, which already has tenant isolation and per-command rules
-- (SELECT for members, UPDATE for OWNER/ADMIN, no INSERT or DELETE on
-- app_user) from 0B and phase 1. Table-level grants are unchanged, so the
-- P-CAT1 matrix in prisma/rls/phases.mjs keeps its existing OrgSettings
-- row; a new P-C1-01 case there exercises the two columns.
--
-- app.org_settings_guard (20260924000100_b1_ballot_visibility_owner) is
-- attached to BEFORE UPDATE OF "ballotIndividualVisibility" only, so it
-- does not fire for these columns and needs no change.

ALTER TABLE "OrgSettings"
  ADD COLUMN "setupCompletedAt" TIMESTAMP(3),
  ADD COLUMN "setupSkipped"     TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Existing rows predate the column default.
UPDATE "OrgSettings" SET "setupSkipped" = ARRAY[]::TEXT[] WHERE "setupSkipped" IS NULL;
