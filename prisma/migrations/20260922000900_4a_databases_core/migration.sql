-- =====================================================================
-- Phase 4a: Databases core (the Event/Session slice and DatabaseDefinition)
-- =====================================================================
-- A Session in Databases and a calendar event are the same Event row. This
-- adds kind/visibility/host/rsvp/term fields, the built-in database
-- definitions for every org, app.term_of(), and tightens 0B's Event
-- policies so members can neither create nor edit PUBLIC events.

-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('WORKSHOP', 'SOCIAL', 'HACKATHON', 'INFO_SESSION', 'BOARD_MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "EventVisibility" AS ENUM ('PUBLIC', 'INTERNAL');

-- CreateEnum
CREATE TYPE "DatabaseKind" AS ENUM ('ATTENDANCE', 'BALLOTS', 'SIGNUPS', 'SESSIONS', 'PEOPLE', 'CUSTOM');

-- DropIndex
DROP INDEX "Event_startsAt_idx";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "attendanceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hostName" TEXT,
ADD COLUMN     "hostUserId" TEXT,
ADD COLUMN     "kind" "EventKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "mergedIntoId" TEXT,
ADD COLUMN     "rsvpUrl" TEXT,
ADD COLUMN     "stampSlot" INTEGER,
ADD COLUMN     "suiteEditedAt" TIMESTAMP(3),
ADD COLUMN     "term" TEXT,
ADD COLUMN     "visibility" "EventVisibility" NOT NULL DEFAULT 'INTERNAL';

-- CreateTable
CREATE TABLE "DatabaseDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "kind" "DatabaseKind" NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "memberVisibility" "MemberVisibility" NOT NULL DEFAULT 'MEMBERS',
    "allowEdits" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DatabaseDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DatabaseDefinition_organizationId_kind_idx" ON "DatabaseDefinition"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseDefinition_organizationId_key_key" ON "DatabaseDefinition"("organizationId", "key");

-- CreateIndex
CREATE INDEX "Event_organizationId_deletedAt_kind_startsAt_idx" ON "Event"("organizationId", "deletedAt", "kind", "startsAt");

-- CreateIndex
CREATE INDEX "Event_organizationId_visibility_deletedAt_startsAt_idx" ON "Event"("organizationId", "visibility", "deletedAt", "startsAt");

-- CreateIndex
CREATE INDEX "Event_organizationId_term_startsAt_idx" ON "Event"("organizationId", "term", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Event_organizationId_id_key" ON "Event"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseDefinition" ADD CONSTRAINT "DatabaseDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Security layer and SQL helpers (hand-written)
-- =====================================================================

-- The website's signup_term rule (signups.sql:63-72), adapted to the
-- suite's TIMESTAMP(3)-without-time-zone columns, which hold UTC: the local
-- date in p_tz decides the term, split at July 1 (Jan-Jun spring-YYYY,
-- Jul-Dec fall-YYYY). Independent of the session TimeZone.
CREATE OR REPLACE FUNCTION app.term_of(p_ts timestamp, p_tz text) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN p_ts IS NULL THEN NULL
              ELSE (CASE WHEN extract(month FROM l.t) >= 7 THEN 'fall-' ELSE 'spring-' END)
                   || extract(year FROM l.t)::int::text END
    FROM (SELECT (p_ts AT TIME ZONE 'UTC') AT TIME ZONE coalesce(nullif(p_tz, ''), 'UTC') AS t) l
$$;

-- Event defaults on INSERT: term from the org timezone when not given.
-- SECURITY DEFINER so it works for every runtime role (app_legacy creates
-- events too) without granting it the helper or the org lookup.
CREATE OR REPLACE FUNCTION app.event_defaults() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW."term" IS NULL THEN
    NEW."term" := app.term_of(NEW."startsAt",
      (SELECT o."timezone" FROM public."Organization" o WHERE o."id" = NEW."organizationId"));
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER event_defaults BEFORE INSERT ON "Event"
  FOR EACH ROW EXECUTE FUNCTION app.event_defaults();

-- A user referenced by an org-scoped row (Event host here; Task owner, the
-- mentioned user and Contact.userId later) must be a current member of that
-- row's org. Same class as 0B's assert_member_of_parent_org (bulkAssign),
-- for columns on the row itself. Fires only when the column is set or
-- changed, so a member who later leaves stays on old rows. SECURITY DEFINER:
-- the answer must not depend on the caller's RLS.
CREATE OR REPLACE FUNCTION app.assert_org_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  k text;
  v_user text;
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
BEGIN
  FOREACH k IN ARRAY TG_ARGV LOOP
    v_user := v_new ->> k;
    CONTINUE WHEN v_user IS NULL;
    CONTINUE WHEN TG_OP = 'UPDATE' AND v_user IS NOT DISTINCT FROM (v_old ->> k)
      AND (v_new ->> 'organizationId') IS NOT DISTINCT FROM (v_old ->> 'organizationId');
    IF NOT EXISTS (SELECT 1 FROM public."Membership" m
                    WHERE m."userId" = v_user AND m."organizationId" = (v_new ->> 'organizationId')) THEN
      RAISE EXCEPTION '%.%: user is not a member of this organization', TG_TABLE_NAME, k USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER org_member_refs BEFORE INSERT OR UPDATE ON "Event"
  FOR EACH ROW EXECUTE FUNCTION app.assert_org_member('hostUserId');
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "Event"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('mergedIntoId', 'Event');

-- Built-in databases for every org, now and at creation (the
-- organization_defaults trigger calls this). Visibility defaults follow the
-- PII decision: signups ADMINS; attendance, sessions, ballots (aggregates;
-- ballot rows are gated by OrgSettings.ballotIndividualVisibility) and
-- people MEMBERS. columns '[]' = the built-in column set from code.
CREATE OR REPLACE FUNCTION app.ensure_org_defaults(p_org text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public."OrgSettings" ("organizationId", "updatedAt")
  VALUES (p_org, app.utc_now())
  ON CONFLICT ("organizationId") DO NOTHING;

  INSERT INTO public."DatabaseDefinition"
    ("id", "organizationId", "key", "name", "icon", "kind", "columns", "memberVisibility", "allowEdits",
     "sortOrder", "createdAt", "updatedAt")
  SELECT 'db_' || replace((gen_random_uuid())::text, '-', ''), p_org, d.key, d.name, d.icon,
         d.kind::public."DatabaseKind", '[]'::jsonb, d.vis::public."MemberVisibility", d.edits, d.ord,
         app.utc_now(), app.utc_now()
    FROM (VALUES
      ('sessions',   'Sessions',   'CalendarDays',   'SESSIONS',   'MEMBERS', true,  0),
      ('attendance', 'Attendance', 'ClipboardCheck', 'ATTENDANCE', 'MEMBERS', true,  1),
      ('signups',    'Signups',    'UserPlus',       'SIGNUPS',    'ADMINS',  true,  2),
      ('ballots',    'Ballots',    'Vote',           'BALLOTS',    'MEMBERS', true,  3),
      ('people',     'People',     'Users',          'PEOPLE',     'MEMBERS', false, 4)
    ) AS d(key, name, icon, kind, vis, edits, ord)
  ON CONFLICT ("organizationId", "key") DO NOTHING;
END $$;

SELECT app.ensure_org_defaults(o."id") FROM "Organization" o;

-- Existing events get their term from the org timezone.
UPDATE "Event" e SET "term" = app.term_of(e."startsAt", o."timezone")
  FROM "Organization" o WHERE o."id" = e."organizationId" AND e."term" IS NULL;

-- ---- Event policies (replace 0B's, one app_user policy per command) -----
-- Members create and edit only their own INTERNAL events; OWNER/ADMIN manage
-- everything. A member can neither publish their own event nor hand it to
-- someone else (createdById is also immutable, 0B immutable_cols).
DROP POLICY app_user_insert ON "Event";
DROP POLICY app_user_update ON "Event";
DROP POLICY app_user_delete ON "Event";
CREATE POLICY app_user_insert ON "Event" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND "createdById" = (SELECT app.user_id())
              AND ((SELECT app.is_org_admin()) OR "visibility" = 'INTERNAL'));
CREATE POLICY app_user_update ON "Event" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_org_admin())
              OR ("createdById" = (SELECT app.user_id()) AND "visibility" = 'INTERNAL')))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ((SELECT app.is_org_admin())
                   OR ("createdById" = (SELECT app.user_id()) AND "visibility" = 'INTERNAL')));
CREATE POLICY app_user_delete ON "Event" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_org_admin())
              OR ("createdById" = (SELECT app.user_id()) AND "visibility" = 'INTERNAL')));

-- ---- DatabaseDefinition ---------------------------------------------------
-- Members read; OWNER/ADMIN create and edit; no DELETE (archive instead).
ALTER TABLE "DatabaseDefinition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_user_select ON "DatabaseDefinition" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "DatabaseDefinition" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "DatabaseDefinition" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "DatabaseDefinition" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "DatabaseDefinition" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "DatabaseDefinition" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "DatabaseDefinition" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "DatabaseDefinition" FROM PUBLIC, app_user, app_service, app_auth, app_legacy;
GRANT SELECT, INSERT, UPDATE ON "DatabaseDefinition" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "DatabaseDefinition" TO app_service;

REVOKE EXECUTE ON FUNCTION app.term_of(timestamp, text), app.event_defaults(), app.assert_org_member() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.term_of(timestamp, text) TO app_user, app_service;
