-- =====================================================================
-- Phase 4b: Website data (contacts, attendance, signups, ballots, sync)
-- =====================================================================
-- Suite-native, org-scoped tables for the website Supabase sync (and for
-- manual/CSV entry), with maintained rollup columns, PII gated by RLS with
-- the viewer tier as an explicit argument, and synced rows that can be
-- suppressed but never deleted.

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('QR', 'FORM', 'MANUAL');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('SUITE', 'SUPABASE_SYNC', 'CSV');

-- CreateEnum
CREATE TYPE "SignupSource" AS ENUM ('WEB', 'TYPEFORM', 'OFFICER', 'CSV', 'MANUAL');

-- CreateEnum
CREATE TYPE "SignupStatus" AS ENUM ('PENDING', 'ADDED', 'UNSUBSCRIBED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceSessionId" TEXT;

-- CreateTable
CREATE TABLE "EventLinkLog" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLinkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT,
    "emailMasked" TEXT,
    "emailDomain" TEXT,
    "userId" TEXT,
    "unsubscribedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3),
    "sessionsAttended" INTEGER NOT NULL DEFAULT 0,
    "firstCheckInAt" TIMESTAMP(3),
    "lastCheckInAt" TIMESTAMP(3),
    "lapsedSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEmail" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL,
    "method" "AttendanceMethod" NOT NULL,
    "nameAsEntered" TEXT,
    "nameOverride" TEXT,
    "source" "RecordSource" NOT NULL DEFAULT 'SUITE',
    "externalId" TEXT,
    "suppressedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "stampNumber" INTEGER,
    "termStampTotal" INTEGER NOT NULL DEFAULT 0,
    "isFirstVisit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTermStats" (
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "sessionsAttended" INTEGER NOT NULL DEFAULT 0,
    "stampCount" INTEGER NOT NULL DEFAULT 0,
    "firstCheckInAt" TIMESTAMP(3),
    "lastCheckInAt" TIMESTAMP(3),

    CONSTRAINT "ContactTermStats_pkey" PRIMARY KEY ("organizationId","contactId","term")
);

-- CreateTable
CREATE TABLE "Signup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "term" TEXT,
    "channel" "SignupSource" NOT NULL,
    "classYear" TEXT,
    "signedUpAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3),
    "submissions" INTEGER NOT NULL DEFAULT 1,
    "addedToListAt" TIMESTAMP(3),
    "answers" JSONB NOT NULL DEFAULT '{}',
    "externalId" TEXT,
    "suppressedAt" TIMESTAMP(3),
    "recordSource" "RecordSource" NOT NULL DEFAULT 'SUITE',
    "status" "SignupStatus" NOT NULL DEFAULT 'PENDING',
    "firstAttendedAt" TIMESTAMP(3),
    "daysToFirstAttendance" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BallotDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "definition" JSONB NOT NULL,
    "linkedEventId" TEXT,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BallotDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ballot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ballotDefinitionId" TEXT,
    "pollSlug" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "castAt" TIMESTAMP(3) NOT NULL,
    "voterContactId" TEXT,
    "source" "RecordSource" NOT NULL,
    "externalId" TEXT,
    "excludedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ballot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BallotChoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ballotId" TEXT NOT NULL,
    "ballotDefinitionId" TEXT,
    "questionKey" TEXT NOT NULL,
    "choiceKey" TEXT,
    "choiceText" TEXT,
    "isFreeText" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER,

    CONSTRAINT "BallotChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSourceSyncState" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "watermark" JSONB NOT NULL DEFAULT '{}',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "rowsUpserted" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataSourceSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLinkLog_organizationId_createdAt_idx" ON "EventLinkLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Contact_organizationId_userId_idx" ON "Contact"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Contact_organizationId_lastCheckInAt_idx" ON "Contact"("organizationId", "lastCheckInAt");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_organizationId_id_key" ON "Contact"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ContactEmail_organizationId_contactId_idx" ON "ContactEmail"("organizationId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEmail_organizationId_emailNormalized_key" ON "ContactEmail"("organizationId", "emailNormalized");

-- CreateIndex
CREATE INDEX "Attendance_organizationId_checkedInAt_idx" ON "Attendance"("organizationId", "checkedInAt");

-- CreateIndex
CREATE INDEX "Attendance_organizationId_contactId_checkedInAt_idx" ON "Attendance"("organizationId", "contactId", "checkedInAt");

-- CreateIndex
CREATE INDEX "Attendance_organizationId_eventId_checkedInAt_idx" ON "Attendance"("organizationId", "eventId", "checkedInAt");

-- CreateIndex
CREATE INDEX "Attendance_organizationId_term_termStampTotal_idx" ON "Attendance"("organizationId", "term", "termStampTotal");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_organizationId_eventId_contactId_key" ON "Attendance"("organizationId", "eventId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_organizationId_source_externalId_key" ON "Attendance"("organizationId", "source", "externalId");

-- CreateIndex
CREATE INDEX "ContactTermStats_organizationId_term_stampCount_idx" ON "ContactTermStats"("organizationId", "term", "stampCount");

-- CreateIndex
CREATE INDEX "Signup_organizationId_signedUpAt_idx" ON "Signup"("organizationId", "signedUpAt");

-- CreateIndex
CREATE INDEX "Signup_organizationId_status_signedUpAt_idx" ON "Signup"("organizationId", "status", "signedUpAt");

-- CreateIndex
CREATE UNIQUE INDEX "Signup_organizationId_contactId_term_key" ON "Signup"("organizationId", "contactId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "Signup_organizationId_recordSource_externalId_key" ON "Signup"("organizationId", "recordSource", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "BallotDefinition_organizationId_slug_key" ON "BallotDefinition"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "BallotDefinition_organizationId_id_key" ON "BallotDefinition"("organizationId", "id");

-- CreateIndex
CREATE INDEX "Ballot_organizationId_pollSlug_castAt_idx" ON "Ballot"("organizationId", "pollSlug", "castAt");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_organizationId_source_externalId_key" ON "Ballot"("organizationId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Ballot_organizationId_id_key" ON "Ballot"("organizationId", "id");

-- CreateIndex
CREATE INDEX "BallotChoice_organizationId_ballotDefinitionId_questionKey__idx" ON "BallotChoice"("organizationId", "ballotDefinitionId", "questionKey", "choiceKey");

-- CreateIndex
CREATE INDEX "BallotChoice_organizationId_ballotId_idx" ON "BallotChoice"("organizationId", "ballotId");

-- CreateIndex
CREATE UNIQUE INDEX "DataSourceSyncState_integrationId_stream_key" ON "DataSourceSyncState"("integrationId", "stream");

-- CreateIndex
CREATE UNIQUE INDEX "Event_organizationId_sourceSessionId_key" ON "Event"("organizationId", "sourceSessionId");

-- AddForeignKey
ALTER TABLE "EventLinkLog" ADD CONSTRAINT "EventLinkLog_organizationId_eventId_fkey" FOREIGN KEY ("organizationId", "eventId") REFERENCES "Event"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEmail" ADD CONSTRAINT "ContactEmail_organizationId_contactId_fkey" FOREIGN KEY ("organizationId", "contactId") REFERENCES "Contact"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_organizationId_eventId_fkey" FOREIGN KEY ("organizationId", "eventId") REFERENCES "Event"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_organizationId_contactId_fkey" FOREIGN KEY ("organizationId", "contactId") REFERENCES "Contact"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTermStats" ADD CONSTRAINT "ContactTermStats_organizationId_contactId_fkey" FOREIGN KEY ("organizationId", "contactId") REFERENCES "Contact"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signup" ADD CONSTRAINT "Signup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signup" ADD CONSTRAINT "Signup_organizationId_contactId_fkey" FOREIGN KEY ("organizationId", "contactId") REFERENCES "Contact"("organizationId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotDefinition" ADD CONSTRAINT "BallotDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotDefinition" ADD CONSTRAINT "BallotDefinition_linkedEventId_fkey" FOREIGN KEY ("linkedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_ballotDefinitionId_fkey" FOREIGN KEY ("ballotDefinitionId") REFERENCES "BallotDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_voterContactId_fkey" FOREIGN KEY ("voterContactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BallotChoice" ADD CONSTRAINT "BallotChoice_organizationId_ballotId_fkey" FOREIGN KEY ("organizationId", "ballotId") REFERENCES "Ballot"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSourceSyncState" ADD CONSTRAINT "DataSourceSyncState_organizationId_integrationId_fkey" FOREIGN KEY ("organizationId", "integrationId") REFERENCES "OrgIntegration"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Security layer and SQL functions (hand-written)
-- =====================================================================

-- ---- Cross-row integrity ------------------------------------------------
-- Optional references are single-column FKs (a composite FK cannot SET
-- NULL only its second column), kept inside the org by 0B's same-org
-- trigger. A linked Contact.userId must be a current member of the org.
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "BallotDefinition"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('linkedEventId', 'Event');
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "Ballot"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('ballotDefinitionId', 'BallotDefinition', 'voterContactId', 'Contact');
CREATE TRIGGER org_member_refs BEFORE INSERT OR UPDATE ON "Contact"
  FOR EACH ROW EXECUTE FUNCTION app.assert_org_member('userId');

-- The record source is immutable, so a synced row cannot be relabelled as
-- suite-native and then deleted.
CREATE TRIGGER immutable_cols BEFORE UPDATE OF "source" ON "Attendance"
  FOR EACH ROW EXECUTE FUNCTION app.immutable_columns('source');
CREATE TRIGGER immutable_cols BEFORE UPDATE OF "recordSource" ON "Signup"
  FOR EACH ROW EXECUTE FUNCTION app.immutable_columns('recordSource');
CREATE TRIGGER immutable_cols BEFORE UPDATE OF "source" ON "Ballot"
  FOR EACH ROW EXECUTE FUNCTION app.immutable_columns('source');

-- ---- Tier functions (PII visibility) -------------------------------------
-- The viewer tier is always an explicit argument, never read from a session
-- GUC, so the same functions are correct in app_user policies (which pass
-- (SELECT app.member_tier())) and in cached service-path loaders (which pass
-- the tier the request computed after authorization). TREASURER counts as
-- MEMBER. Each returns false for any org other than the caller's org GUC.
--
-- can_view_rows kinds: ATTENDANCE, BALLOTS, SIGNUPS, SESSIONS, PEOPLE,
-- CUSTOM (DatabaseDefinition.memberVisibility of that org's database of the
-- kind) and CONTACT_EMAIL (OrgSettings.contactEmailVisibility).
-- Visibility levels: MEMBERS = every tier; ADMINS = OWNER/ADMIN; OWNER =
-- OWNER only; HIDDEN = not listed for members, rows still visible to
-- OWNER/ADMIN so they can manage them. Defaults when no row exists: SIGNUPS
-- and CONTACT_EMAIL ADMINS, everything else MEMBERS.
CREATE OR REPLACE FUNCTION app.can_view_rows(p_org text, p_kind text, p_tier text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tier text := CASE WHEN p_tier = 'TREASURER' THEN 'MEMBER' ELSE p_tier END;
  v_vis text;
BEGIN
  IF p_org IS NULL OR v_tier IS NULL OR v_tier NOT IN ('OWNER', 'ADMIN', 'MEMBER')
     OR p_org IS DISTINCT FROM app.org_id() THEN
    RETURN false;
  END IF;
  IF p_kind = 'CONTACT_EMAIL' THEN
    SELECT s."contactEmailVisibility"::text INTO v_vis FROM public."OrgSettings" s WHERE s."organizationId" = p_org;
    v_vis := coalesce(v_vis, 'ADMINS');
  ELSIF p_kind IN ('ATTENDANCE', 'BALLOTS', 'SIGNUPS', 'SESSIONS', 'PEOPLE', 'CUSTOM') THEN
    SELECT d."memberVisibility"::text INTO v_vis FROM public."DatabaseDefinition" d
     WHERE d."organizationId" = p_org AND d."kind"::text = p_kind
     ORDER BY d."sortOrder", d."createdAt" LIMIT 1;
    v_vis := coalesce(v_vis, CASE WHEN p_kind = 'SIGNUPS' THEN 'ADMINS' ELSE 'MEMBERS' END);
  ELSE
    RETURN false;
  END IF;
  RETURN CASE v_vis
    WHEN 'MEMBERS' THEN true
    WHEN 'ADMINS' THEN v_tier IN ('OWNER', 'ADMIN')
    WHEN 'HIDDEN' THEN v_tier IN ('OWNER', 'ADMIN')
    WHEN 'OWNER' THEN v_tier = 'OWNER'
    ELSE false END;
END $$;

-- Individual ballots (who voted for what) per
-- OrgSettings.ballotIndividualVisibility: OWNER_ONLY (default),
-- OWNER_AND_ADMINS or NOBODY.
CREATE OR REPLACE FUNCTION app.can_view_ballot_rows(p_org text, p_tier text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tier text := CASE WHEN p_tier = 'TREASURER' THEN 'MEMBER' ELSE p_tier END;
  v_vis text;
BEGIN
  IF p_org IS NULL OR v_tier IS NULL OR v_tier NOT IN ('OWNER', 'ADMIN', 'MEMBER')
     OR p_org IS DISTINCT FROM app.org_id() THEN
    RETURN false;
  END IF;
  SELECT s."ballotIndividualVisibility"::text INTO v_vis FROM public."OrgSettings" s WHERE s."organizationId" = p_org;
  RETURN CASE coalesce(v_vis, 'OWNER_ONLY')
    WHEN 'OWNER_ONLY' THEN v_tier = 'OWNER'
    WHEN 'OWNER_AND_ADMINS' THEN v_tier IN ('OWNER', 'ADMIN')
    ELSE false END;
END $$;

-- Aggregate results of one BallotDefinition for a viewer tier: per question
-- and option, votes; for ranked (slots) questions also first-choice counts
-- and a Borda score (an option ranked r on a ballot that ranks n options
-- scores n - r + 1). Free text is never tallied. Excluded ballots (test,
-- out of window) are skipped. For tiers without row access every cell below
-- OrgSettings.ballotMinCellSize is suppressed (votes, first_choice and borda
-- NULL, suppressed = true; the UI shows '<k'). A MEMBER gets nothing while
-- ballotResultsVisibleToMembers is false. Requires p_org = app.org_id(); an
-- app_user caller can never claim a tier above its own membership.
CREATE OR REPLACE FUNCTION app.ballot_tally(p_org text, p_definition_id text, p_tier text)
RETURNS TABLE (question_key text, choice_key text, votes integer, first_choice integer, borda integer,
               ballots integer, suppressed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_tier text := CASE WHEN p_tier = 'TREASURER' THEN 'MEMBER' ELSE p_tier END;
  v_member text;
  v_rank_of_tier integer;
  v_k integer;
  v_results_visible boolean;
  v_rows boolean;
BEGIN
  IF app.org_id() IS NULL OR p_org IS DISTINCT FROM app.org_id() THEN
    RAISE EXCEPTION 'ballot_tally: not permitted' USING ERRCODE = '42501';
  END IF;
  IF v_tier IS NULL OR v_tier NOT IN ('OWNER', 'ADMIN', 'MEMBER') THEN
    RAISE EXCEPTION 'ballot_tally: invalid tier' USING ERRCODE = '22023';
  END IF;
  IF session_user = 'app_user' THEN
    v_member := CASE WHEN app.member_tier()::text = 'TREASURER' THEN 'MEMBER' ELSE app.member_tier()::text END;
    IF v_member IS NULL THEN
      RAISE EXCEPTION 'ballot_tally: not permitted' USING ERRCODE = '42501';
    END IF;
    v_rank_of_tier := least(array_position(ARRAY['MEMBER', 'ADMIN', 'OWNER'], v_tier),
                            array_position(ARRAY['MEMBER', 'ADMIN', 'OWNER'], v_member));
    v_tier := (ARRAY['MEMBER', 'ADMIN', 'OWNER'])[v_rank_of_tier];
  END IF;

  SELECT s."ballotMinCellSize", s."ballotResultsVisibleToMembers" INTO v_k, v_results_visible
    FROM public."OrgSettings" s WHERE s."organizationId" = p_org;
  v_k := coalesce(v_k, 3);
  v_results_visible := coalesce(v_results_visible, true);
  IF v_tier = 'MEMBER' AND NOT v_results_visible THEN
    RETURN;
  END IF;
  v_rows := app.can_view_ballot_rows(p_org, v_tier);

  RETURN QUERY
  WITH valid AS (
    SELECT b."id" FROM public."Ballot" b
     WHERE b."organizationId" = p_org AND b."ballotDefinitionId" = p_definition_id AND b."excludedReason" IS NULL
  ), ch AS (
    SELECT c."questionKey" AS qk, c."choiceKey" AS ck, c."ballotId" AS bid, c."rank" AS rk,
           count(*) FILTER (WHERE c."rank" IS NOT NULL) OVER (PARTITION BY c."ballotId", c."questionKey") AS n_ranked
      FROM public."BallotChoice" c JOIN valid v ON v."id" = c."ballotId"
     WHERE c."organizationId" = p_org AND NOT c."isFreeText" AND c."choiceKey" IS NOT NULL
  ), per_q AS (
    SELECT ch.qk, count(DISTINCT ch.bid)::integer AS n_ballots FROM ch GROUP BY ch.qk
  ), agg AS (
    SELECT ch.qk, ch.ck, count(*)::integer AS n_votes,
           CASE WHEN bool_or(ch.rk IS NOT NULL) THEN (count(*) FILTER (WHERE ch.rk = 1))::integer END AS n_first,
           CASE WHEN bool_or(ch.rk IS NOT NULL)
                THEN (sum(CASE WHEN ch.rk IS NOT NULL THEN ch.n_ranked - ch.rk + 1 ELSE 0 END))::integer END AS n_borda
      FROM ch GROUP BY ch.qk, ch.ck
  )
  SELECT a.qk, a.ck,
         CASE WHEN x.s THEN NULL ELSE a.n_votes END,
         CASE WHEN x.s THEN NULL ELSE a.n_first END,
         CASE WHEN x.s THEN NULL ELSE a.n_borda END,
         q.n_ballots,
         x.s
    FROM agg a
    JOIN per_q q ON q.qk = a.qk
    CROSS JOIN LATERAL (SELECT (NOT v_rows AND a.n_votes < v_k) AS s) x
   ORDER BY a.qk, a.n_votes DESC, a.ck;
END $$;

-- Rewrites the BallotChoice rows of one ballot from Ballot.answers, a
-- {questionKey: value} object, using the question types in the ballot's
-- BallotDefinition.definition ({questions: [{key, type}]}):
--   slots  array, ranked: one row per element with rank = position (1-based)
--   multi  array: one row per element, no rank
--   single / yesno  scalar: one row (booleans become 'yes' / 'no')
--   text   free text: one row with isFreeText and choiceText (max 2000)
-- A question missing from the definition is treated as multi (array) or
-- single (scalar). Callers: an OWNER/ADMIN in their org's app_user tx, or
-- the sync on the service path. Returns the number of rows written.
CREATE OR REPLACE FUNCTION app.explode_ballot(p_org text, p_ballot_id text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_answers jsonb;
  v_def_id text;
  v_questions jsonb;
  v_n integer;
BEGIN
  IF session_user = 'app_user' THEN
    IF p_org IS NULL OR p_org IS DISTINCT FROM app.member_org_id() OR NOT app.is_org_admin() THEN
      RAISE EXCEPTION 'explode_ballot: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user = 'app_service' THEN
    IF app.org_id() IS NULL OR p_org IS DISTINCT FROM app.org_id() THEN
      RAISE EXCEPTION 'explode_ballot: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user <> current_user THEN
    RAISE EXCEPTION 'explode_ballot: not permitted' USING ERRCODE = '42501';
  END IF;

  SELECT b."answers", b."ballotDefinitionId" INTO v_answers, v_def_id
    FROM public."Ballot" b WHERE b."id" = p_ballot_id AND b."organizationId" = p_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'explode_ballot: not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT d."definition" -> 'questions' INTO v_questions
    FROM public."BallotDefinition" d WHERE d."id" = v_def_id AND d."organizationId" = p_org;
  IF v_questions IS NULL OR jsonb_typeof(v_questions) <> 'array' THEN
    v_questions := '[]'::jsonb;
  END IF;
  IF v_answers IS NULL OR jsonb_typeof(v_answers) <> 'object' THEN
    v_answers := '{}'::jsonb;
  END IF;

  DELETE FROM public."BallotChoice" WHERE "organizationId" = p_org AND "ballotId" = p_ballot_id;

  INSERT INTO public."BallotChoice" ("id", "organizationId", "ballotId", "ballotDefinitionId", "questionKey",
                                     "choiceKey", "choiceText", "isFreeText", "rank")
  SELECT 'bch_' || replace((gen_random_uuid())::text, '-', ''), p_org, p_ballot_id, v_def_id, a.key,
         x.choice_key, x.choice_text, x.is_free, x.rnk
    FROM jsonb_each(v_answers) AS a(key, value)
    LEFT JOIN LATERAL (
      SELECT q ->> 'type' AS qtype FROM jsonb_array_elements(v_questions) q WHERE q ->> 'key' = a.key LIMIT 1
    ) qd ON true
    CROSS JOIN LATERAL (
      SELECT e.value #>> '{}' AS choice_key, NULL::text AS choice_text, false AS is_free,
             CASE WHEN qd.qtype = 'slots' THEN e.ord::integer END AS rnk
        FROM jsonb_array_elements(a.value) WITH ORDINALITY AS e(value, ord)
       WHERE jsonb_typeof(a.value) = 'array' AND coalesce(qd.qtype, '') <> 'text'
         AND jsonb_typeof(e.value) IN ('string', 'number', 'boolean') AND (e.value #>> '{}') <> ''
      UNION ALL
      SELECT NULL, left(a.value #>> '{}', 2000), true, NULL
       WHERE qd.qtype = 'text' AND jsonb_typeof(a.value) IN ('string', 'number')
         AND btrim(a.value #>> '{}') <> ''
      UNION ALL
      SELECT CASE WHEN jsonb_typeof(a.value) = 'boolean'
                  THEN CASE WHEN (a.value #>> '{}') = 'true' THEN 'yes' ELSE 'no' END
                  ELSE a.value #>> '{}' END,
             NULL, false, NULL
       WHERE jsonb_typeof(a.value) IN ('string', 'number', 'boolean') AND coalesce(qd.qtype, '') <> 'text'
         AND (a.value #>> '{}') <> ''
    ) x;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ---- Rollups ---------------------------------------------------------------
-- Recomputes every maintained column that depends on check-ins, for the
-- given contacts (NULL = every contact of the org). Called in the same
-- transaction as every write path: sync batches, manual attendance, CSV
-- import, suppress, contact merge and event merge. After an Event's term or
-- a merge changes, call it with NULL (or that event's contacts).
--   Attendance.term           the Event's term, else app.term_of(checkedInAt, org tz)
--   Attendance.stampNumber    row_number over (contact, term) by checkedInAt, NULL if suppressed
--   Attendance.termStampTotal non-suppressed check-ins of the contact in that term
--   Attendance.isFirstVisit   the contact's earliest non-suppressed check-in
--   ContactTermStats          rebuilt per (contact, term)
--   Contact                   sessionsAttended, firstCheckInAt, lastCheckInAt
--   Signup                    status (UNSUBSCRIBED > ADDED > PENDING), firstAttendedAt
--                             (first check-in from one day before the signup on),
--                             daysToFirstAttendance (>= 0)
--   Event.attendanceCount     for every event of the org
-- SECURITY DEFINER so the result never depends on the caller's row
-- visibility; callers are OWNER/ADMIN of p_org (app_user) or the service
-- path with the org GUC.
CREATE OR REPLACE FUNCTION app.refresh_contact_rollups(p_org text, p_contact_ids text[] DEFAULT NULL) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tz text;
BEGIN
  IF session_user = 'app_user' THEN
    IF p_org IS NULL OR p_org IS DISTINCT FROM app.member_org_id() OR NOT app.is_org_admin() THEN
      RAISE EXCEPTION 'refresh_contact_rollups: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user = 'app_service' THEN
    IF app.org_id() IS NULL OR p_org IS DISTINCT FROM app.org_id() THEN
      RAISE EXCEPTION 'refresh_contact_rollups: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user <> current_user THEN
    RAISE EXCEPTION 'refresh_contact_rollups: not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT o."timezone" INTO v_tz FROM public."Organization" o WHERE o."id" = p_org;

  -- 0. Term follows the Event.
  UPDATE public."Attendance" a
     SET "term" = coalesce(e."term", app.term_of(a."checkedInAt", v_tz))
    FROM public."Event" e
   WHERE a."organizationId" = p_org AND e."organizationId" = a."organizationId" AND e."id" = a."eventId"
     AND (p_contact_ids IS NULL OR a."contactId" = ANY (p_contact_ids))
     AND a."term" IS DISTINCT FROM coalesce(e."term", app.term_of(a."checkedInAt", v_tz));

  -- 1. Per-check-in stamp columns.
  WITH scope AS (
    SELECT a."id", a."contactId", a."term", a."checkedInAt", a."suppressedAt"
      FROM public."Attendance" a
     WHERE a."organizationId" = p_org AND (p_contact_ids IS NULL OR a."contactId" = ANY (p_contact_ids))
  ), live AS (
    SELECT s."id",
           row_number() OVER (PARTITION BY s."contactId", s."term" ORDER BY s."checkedInAt", s."id")::integer AS stamp,
           row_number() OVER (PARTITION BY s."contactId" ORDER BY s."checkedInAt", s."id") = 1 AS first_visit
      FROM scope s WHERE s."suppressedAt" IS NULL
  ), totals AS (
    SELECT s."contactId", s."term", count(*)::integer AS n
      FROM scope s WHERE s."suppressedAt" IS NULL GROUP BY s."contactId", s."term"
  ), calc AS (
    SELECT s."id", l.stamp, coalesce(t.n, 0) AS term_total, coalesce(l.first_visit, false) AS first_visit
      FROM scope s
      LEFT JOIN live l ON l."id" = s."id"
      LEFT JOIN totals t ON t."contactId" = s."contactId" AND t."term" = s."term"
  )
  UPDATE public."Attendance" a
     SET "stampNumber" = c.stamp, "termStampTotal" = c.term_total, "isFirstVisit" = c.first_visit
    FROM calc c
   WHERE a."id" = c."id"
     AND (a."stampNumber" IS DISTINCT FROM c.stamp OR a."termStampTotal" <> c.term_total
          OR a."isFirstVisit" <> c.first_visit);

  -- 2. Per-term stats.
  DELETE FROM public."ContactTermStats" t
   WHERE t."organizationId" = p_org AND (p_contact_ids IS NULL OR t."contactId" = ANY (p_contact_ids));
  INSERT INTO public."ContactTermStats" ("organizationId", "contactId", "term", "sessionsAttended", "stampCount",
                                         "firstCheckInAt", "lastCheckInAt")
  SELECT p_org, a."contactId", a."term", count(DISTINCT a."eventId")::integer, count(*)::integer,
         min(a."checkedInAt"), max(a."checkedInAt")
    FROM public."Attendance" a
   WHERE a."organizationId" = p_org AND a."suppressedAt" IS NULL
     AND (p_contact_ids IS NULL OR a."contactId" = ANY (p_contact_ids))
   GROUP BY a."contactId", a."term";

  -- 3. All-time contact stats.
  UPDATE public."Contact" c
     SET "sessionsAttended" = x.n, "firstCheckInAt" = x.first_at, "lastCheckInAt" = x.last_at
    FROM (SELECT c2."id", count(a."id")::integer AS n, min(a."checkedInAt") AS first_at, max(a."checkedInAt") AS last_at
            FROM public."Contact" c2
            LEFT JOIN public."Attendance" a
              ON a."organizationId" = c2."organizationId" AND a."contactId" = c2."id" AND a."suppressedAt" IS NULL
           WHERE c2."organizationId" = p_org AND (p_contact_ids IS NULL OR c2."id" = ANY (p_contact_ids))
           GROUP BY c2."id") x
   WHERE c."id" = x."id"
     AND (c."sessionsAttended" <> x.n OR c."firstCheckInAt" IS DISTINCT FROM x.first_at
          OR c."lastCheckInAt" IS DISTINCT FROM x.last_at);

  -- 4. Signups.
  UPDATE public."Signup" s
     SET "status" = x.status::public."SignupStatus", "firstAttendedAt" = x.first_at, "daysToFirstAttendance" = x.days
    FROM (SELECT s2."id",
                 CASE WHEN c."unsubscribedAt" IS NOT NULL THEN 'UNSUBSCRIBED'
                      WHEN s2."addedToListAt" IS NOT NULL THEN 'ADDED'
                      ELSE 'PENDING' END AS status,
                 f.first_at,
                 CASE WHEN f.first_at IS NULL THEN NULL
                      ELSE greatest(0, floor(extract(epoch FROM f.first_at - s2."signedUpAt") / 86400))::integer END AS days
            FROM public."Signup" s2
            JOIN public."Contact" c ON c."organizationId" = s2."organizationId" AND c."id" = s2."contactId"
            LEFT JOIN LATERAL (
              SELECT min(a."checkedInAt") AS first_at FROM public."Attendance" a
               WHERE a."organizationId" = s2."organizationId" AND a."contactId" = s2."contactId"
                 AND a."suppressedAt" IS NULL AND a."checkedInAt" >= s2."signedUpAt" - interval '1 day'
            ) f ON true
           WHERE s2."organizationId" = p_org AND (p_contact_ids IS NULL OR s2."contactId" = ANY (p_contact_ids))) x
   WHERE s."id" = x."id"
     AND (s."status"::text <> x.status OR s."firstAttendedAt" IS DISTINCT FROM x.first_at
          OR s."daysToFirstAttendance" IS DISTINCT FROM x.days);

  -- 5. Event attendance counts.
  UPDATE public."Event" e
     SET "attendanceCount" = x.n
    FROM (SELECT e2."id", count(a."id")::integer AS n
            FROM public."Event" e2
            LEFT JOIN public."Attendance" a
              ON a."organizationId" = e2."organizationId" AND a."eventId" = e2."id" AND a."suppressedAt" IS NULL
           WHERE e2."organizationId" = p_org
           GROUP BY e2."id") x
   WHERE e."id" = x."id" AND e."attendanceCount" <> x.n;
END $$;

-- Contact.lapsedSince: a contact is lapsed once the org has held
-- OrgSettings.lapsedAfterSessions (default 3) sessions since the last
-- session they attended; lapsedSince is the start of the first of those
-- missed sessions. A session is a non-deleted, non-merged Event that has
-- started and has at least one check-in. Run by the coalesced
-- ROLLUP_LAPSED:{orgId} job after a session's first check-in and nightly.
-- Returns the number of contacts whose value changed.
CREATE OR REPLACE FUNCTION app.refresh_lapsed(p_org text) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_after integer;
  v_changed integer;
BEGIN
  IF session_user = 'app_user' THEN
    IF p_org IS NULL OR p_org IS DISTINCT FROM app.member_org_id() OR NOT app.is_org_admin() THEN
      RAISE EXCEPTION 'refresh_lapsed: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user = 'app_service' THEN
    IF app.org_id() IS NULL OR p_org IS DISTINCT FROM app.org_id() THEN
      RAISE EXCEPTION 'refresh_lapsed: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user <> current_user THEN
    RAISE EXCEPTION 'refresh_lapsed: not permitted' USING ERRCODE = '42501';
  END IF;
  SELECT s."lapsedAfterSessions" INTO v_after FROM public."OrgSettings" s WHERE s."organizationId" = p_org;
  v_after := greatest(coalesce(v_after, 3), 1);

  WITH sessions AS (
    SELECT e."startsAt" FROM public."Event" e
     WHERE e."organizationId" = p_org AND e."deletedAt" IS NULL AND e."mergedIntoId" IS NULL
       AND e."attendanceCount" > 0 AND e."startsAt" <= app.utc_now()
  ), last_seen AS (
    SELECT a."contactId", max(e."startsAt") AS last_at
      FROM public."Attendance" a
      JOIN public."Event" e ON e."organizationId" = a."organizationId" AND e."id" = a."eventId"
     WHERE a."organizationId" = p_org AND a."suppressedAt" IS NULL
     GROUP BY a."contactId"
  ), calc AS (
    SELECT c."id",
           CASE WHEN l.last_at IS NULL THEN NULL
                WHEN (SELECT count(*) FROM sessions s WHERE s."startsAt" > l.last_at) >= v_after
                  THEN (SELECT min(s."startsAt") FROM sessions s WHERE s."startsAt" > l.last_at)
           END AS lapsed
      FROM public."Contact" c
      LEFT JOIN last_seen l ON l."contactId" = c."id"
     WHERE c."organizationId" = p_org
  )
  UPDATE public."Contact" c SET "lapsedSince" = calc.lapsed
    FROM calc WHERE c."id" = calc."id" AND c."lapsedSince" IS DISTINCT FROM calc.lapsed;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END $$;

-- ---- Row-level security ---------------------------------------------------
ALTER TABLE "EventLinkLog"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactEmail"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attendance"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContactTermStats"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Signup"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BallotDefinition"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ballot"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BallotChoice"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataSourceSyncState" ENABLE ROW LEVEL SECURITY;

-- SELECT combines tenant scope with the tier passed explicitly. The tier
-- functions are called with (SELECT app.member_org_id()), which equals
-- "organizationId" under the first conjunct, so each is an initplan
-- evaluated once per statement rather than once per row.

-- Contact: visible where any database that shows people is visible.
CREATE POLICY app_user_select ON "Contact" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.can_view_rows((SELECT app.member_org_id()), 'ATTENDANCE', (SELECT app.member_tier())::text))
              OR (SELECT app.can_view_rows((SELECT app.member_org_id()), 'PEOPLE', (SELECT app.member_tier())::text))
              OR (SELECT app.can_view_rows((SELECT app.member_org_id()), 'SIGNUPS', (SELECT app.member_tier())::text))));
CREATE POLICY app_user_insert ON "Contact" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "Contact" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "Contact" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));

CREATE POLICY app_user_select ON "ContactEmail" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND (SELECT app.can_view_rows((SELECT app.member_org_id()), 'CONTACT_EMAIL', (SELECT app.member_tier())::text)));
CREATE POLICY app_user_insert ON "ContactEmail" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "ContactEmail" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "ContactEmail" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));

-- Attendance, Signup and Ballot: synced rows can be suppressed (UPDATE) but
-- never deleted, so the next sync cannot silently resurrect them.
CREATE POLICY app_user_select ON "Attendance" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND (SELECT app.can_view_rows((SELECT app.member_org_id()), 'ATTENDANCE', (SELECT app.member_tier())::text)));
CREATE POLICY app_user_insert ON "Attendance" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "Attendance" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "Attendance" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin())
         AND "source" <> 'SUPABASE_SYNC');

-- ContactTermStats is written only by app.refresh_contact_rollups.
CREATE POLICY app_user_select ON "ContactTermStats" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND (SELECT app.can_view_rows((SELECT app.member_org_id()), 'PEOPLE', (SELECT app.member_tier())::text)));

CREATE POLICY app_user_select ON "Signup" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND (SELECT app.can_view_rows((SELECT app.member_org_id()), 'SIGNUPS', (SELECT app.member_tier())::text)));
CREATE POLICY app_user_insert ON "Signup" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "Signup" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "Signup" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin())
         AND "recordSource" <> 'SUPABASE_SYNC');

CREATE POLICY app_user_select ON "BallotDefinition" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "BallotDefinition" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "BallotDefinition" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "BallotDefinition" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));

CREATE POLICY app_user_select ON "Ballot" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND (SELECT app.can_view_ballot_rows((SELECT app.member_org_id()), (SELECT app.member_tier())::text)));
CREATE POLICY app_user_insert ON "Ballot" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "Ballot" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "Ballot" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin())
         AND "source" <> 'SUPABASE_SYNC');

-- BallotChoice is written only by app.explode_ballot or the sync.
CREATE POLICY app_user_select ON "BallotChoice" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND (SELECT app.can_view_ballot_rows((SELECT app.member_org_id()), (SELECT app.member_tier())::text)));

-- Import audit and sync status: OWNER/ADMIN only.
CREATE POLICY app_user_select ON "EventLinkLog" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_insert ON "EventLinkLog" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin())
              AND ("actorId" IS NULL OR "actorId" = (SELECT app.user_id())));
CREATE POLICY app_user_select ON "DataSourceSyncState" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));

-- Service path: the fail-closed tenant standard (sync, rollup and lapsed
-- jobs; exports; cached reports). It never reads rows for display, so it
-- needs no tier.
CREATE POLICY app_service_select ON "Contact" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Contact" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Contact" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Contact" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "ContactEmail" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "ContactEmail" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "ContactEmail" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "ContactEmail" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "Attendance" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Attendance" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Attendance" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Attendance" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "ContactTermStats" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "ContactTermStats" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "ContactTermStats" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "ContactTermStats" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "Signup" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Signup" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Signup" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Signup" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "BallotDefinition" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "BallotDefinition" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "BallotDefinition" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "BallotDefinition" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "Ballot" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Ballot" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Ballot" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Ballot" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "BallotChoice" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "BallotChoice" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "BallotChoice" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "BallotChoice" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "EventLinkLog" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "EventLinkLog" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "DataSourceSyncState" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "DataSourceSyncState" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "DataSourceSyncState" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "DataSourceSyncState" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- ---- Grants ---------------------------------------------------------------
REVOKE ALL ON "EventLinkLog", "Contact", "ContactEmail", "Attendance", "ContactTermStats", "Signup",
  "BallotDefinition", "Ballot", "BallotChoice", "DataSourceSyncState"
  FROM PUBLIC, app_user, app_service, app_auth, app_legacy;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Contact", "ContactEmail", "Attendance", "Signup", "BallotDefinition", "Ballot" TO app_user;
GRANT SELECT ON "ContactTermStats", "BallotChoice", "DataSourceSyncState" TO app_user;
GRANT SELECT, INSERT ON "EventLinkLog" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Contact", "ContactEmail", "Attendance", "ContactTermStats", "Signup",
  "BallotDefinition", "Ballot", "BallotChoice", "DataSourceSyncState" TO app_service;
GRANT SELECT, INSERT ON "EventLinkLog" TO app_service;

REVOKE EXECUTE ON FUNCTION app.can_view_rows(text, text, text), app.can_view_ballot_rows(text, text),
  app.ballot_tally(text, text, text), app.explode_ballot(text, text),
  app.refresh_contact_rollups(text, text[]), app.refresh_lapsed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_view_rows(text, text, text), app.can_view_ballot_rows(text, text),
  app.ballot_tally(text, text, text), app.explode_ballot(text, text),
  app.refresh_contact_rollups(text, text[]), app.refresh_lapsed(text) TO app_user, app_service;
