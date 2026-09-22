-- =====================================================================
-- Phase 0B migration "rls_roles_policies_triggers"
-- =====================================================================
-- Prisma-generated DDL for the 0B models, followed by the hand-written
-- security layer (sections 1, 2 and 4-9 of the reviewed and tested
-- 0B-rls-draft.sql v3), in the same migration so a table never exists
-- without RLS. Runs as the migration owner (MIGRATE_DATABASE_URL), which
-- owns every table. Prisma does not track roles, functions, triggers,
-- policies or grants; app.security_manifest() (section 9) is the drift
-- guard and prisma/rls/ asserts it returns no rows.
--
-- One hand edit to the generated DDL: NULLS NOT DISTINCT on the Job dedupe
-- index. Prisma 7.10 omits the flag when generating and ignores it when
-- diffing, so T17g asserts it in the catalog.
--
-- The OrgSecret table below is the 0B stub. Phase 1 (migration
-- ..._1_settings_integrations) adds OrgIntegration and the composite FK
-- (organizationId, integrationId); the RLS, grants, per-org uniqueness and
-- accessor SQL here stay unchanged.
-- =====================================================================

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'DEAD', 'CANCELLED');

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "emailSentAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "organizationId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "dedupeKey" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "lockedUntil" TIMESTAMP(3),
    "lockToken" TEXT,
    "rerunRequested" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgAuditLog" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "diffJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "OrgMemberHistory" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstJoinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastJoinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "OrgMemberHistory_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateTable
CREATE TABLE "OrgSecret" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "wrappedDek" BYTEA NOT NULL,
    "dekIv" BYTEA NOT NULL,
    "dekTag" BYTEA NOT NULL,
    "kekVersion" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_organizationId_kind_status_idx" ON "Job"("organizationId", "kind", "status");

-- CreateIndex (HAND-EDITED: NULLS NOT DISTINCT, see the header)
CREATE UNIQUE INDEX "Job_organizationId_dedupeKey_active_key" ON "Job"("organizationId", "dedupeKey") NULLS NOT DISTINCT WHERE (status = ANY (ARRAY['PENDING'::"JobStatus", 'RUNNING'::"JobStatus"]));

-- CreateIndex
CREATE INDEX "OrgAuditLog_organizationId_createdAt_idx" ON "OrgAuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "OrgMemberHistory_userId_idx" ON "OrgMemberHistory"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgSecret_organizationId_integrationId_kind_key" ON "OrgSecret"("organizationId", "integrationId", "kind");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAuditLog" ADD CONSTRAINT "OrgAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgAuditLog" ADD CONSTRAINT "OrgAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMemberHistory" ADD CONSTRAINT "OrgMemberHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgMemberHistory" ADD CONSTRAINT "OrgMemberHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgSecret" ADD CONSTRAINT "OrgSecret_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- Section 1. Roles (cluster-global, idempotent for shadow-DB replays)
-- NOLOGIN here. PRODUCTION ROLLOUT (RUNBOOK): before the 0B deploy, ops
-- pre-creates the four roles with SQL as neondb_owner on the production
-- parent branch (CREATE ROLE ... LOGIN PASSWORD ... NOBYPASSRLS; never
-- through the Neon Console or API, which add neon_superuser membership,
-- inferred; app.security_manifest() reports any role membership). This
-- block then skips CREATE and only sets the defaults below. If ALTER ROLE
-- ... SET is refused it only raises a NOTICE, so /api/health asserts SHOW
-- timezone = 'UTC', statement_timeout = '15s' and
-- idle_in_transaction_session_timeout = '15s' on every runtime URL.
-- CI uses scripts/ci/role-passwords.sql. Passwords are never in git.
-- =====================================================================
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_user', 'app_service', 'app_auth', 'app_legacy'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS', r);
    END IF;
    BEGIN
      -- Timestamps in this schema are TIMESTAMP(3) without time zone holding
      -- UTC, so CURRENT_TIMESTAMP defaults must be computed in UTC.
      EXECUTE format('ALTER ROLE %I SET timezone TO %L', r, 'UTC');
      -- A transaction left open across network I/O is killed instead of
      -- holding a pooled connection and row locks.
      EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout TO %L', r, '15s');
      EXECUTE format('ALTER ROLE %I SET statement_timeout TO %L', r, '15s');
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'could not set defaults on role % (set them out of band)', r;
    END;
  END LOOP;
END $$;


-- =====================================================================
-- Section 2. Schema app, database privileges and the context helpers
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_user, app_service, app_auth, app_legacy;
GRANT USAGE ON SCHEMA app TO app_user, app_service, app_auth, app_legacy;

-- No runtime role may create temporary objects: pg_temp is searched first
-- for relation and type names unless listed explicitly, so a temp table
-- or type could shadow a name inside a definer body (attack N1). The
-- definer functions also list pg_temp last. The owner keeps TEMP.
DO $$
BEGIN
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM app_user, app_service, app_auth, app_legacy',
                 current_database());
END $$;

-- Functions created by this role are not executable by PUBLIC by default.
-- (Must be the global form: per-schema default privileges cannot revoke.)
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- The transaction stamp that binds the context GUCs to one transaction.
-- app.set_context() writes it; the readers below ignore the user and org
-- GUCs unless it matches the CURRENT transaction, so a value that leaked
-- through a session-level set_config(..., false) or SET app.* is dead
-- in the next transaction on the same pooled connection (attack N8).
CREATE OR REPLACE FUNCTION app.ctx_valid() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT coalesce(pg_catalog.current_setting('app.ctx_tx', true)
                  = (extract(epoch FROM pg_catalog.transaction_timestamp()) * 1000000)::bigint::text, false)
$$;

CREATE OR REPLACE FUNCTION app.user_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN app.ctx_valid() THEN nullif(pg_catalog.current_setting('app.user_id', true), '') END $$;

CREATE OR REPLACE FUNCTION app.org_id() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT CASE WHEN app.ctx_valid() THEN nullif(pg_catalog.current_setting('app.org_id', true), '') END $$;

-- UTC wall-clock time for TIMESTAMP(3) columns, independent of TimeZone.
CREATE OR REPLACE FUNCTION app.utc_now() RETURNS timestamp(3)
LANGUAGE sql STABLE PARALLEL SAFE
AS $$ SELECT (now() AT TIME ZONE 'UTC')::timestamp(3) $$;

-- The current user's role in the current org, or NULL. Runs as the table
-- owner, so it reads Membership without RLS (no policy recursion).
CREATE OR REPLACE FUNCTION app.member_role() RETURNS "Role"
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT m."role" FROM public."Membership" m
  WHERE m."userId" = app.user_id() AND m."organizationId" = app.org_id()
$$;

-- The ONLY way request code sets its context: one statement, first in
-- the transaction, e.g. $queryRaw`SELECT app.set_context(${userId}, ${orgId}) AS role`.
-- Transaction-local (set_config(..., true)), stamped with the current
-- transaction, and returns app.member_role() in the same round trip (a
-- NULL role with an org means "not a member" and the wrapper throws).
-- SECURITY INVOKER, no SET clause: it must not open a GUC nest level.
CREATE OR REPLACE FUNCTION app.set_context(p_user text, p_org text) RETURNS "Role"
LANGUAGE sql VOLATILE
AS $$
  SELECT pg_catalog.set_config('app.user_id', coalesce(p_user, ''), true),
         pg_catalog.set_config('app.org_id', coalesce(p_org, ''), true),
         pg_catalog.set_config('app.ctx_tx',
           (extract(epoch FROM pg_catalog.transaction_timestamp()) * 1000000)::bigint::text, true);
  SELECT app.member_role();
$$;

-- app.org_id() only if the current user is a member of it, else NULL.
-- Every app_user tenant policy compares against this, so the database
-- enforces membership, not just org equality.
CREATE OR REPLACE FUNCTION app.member_org_id() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT m."organizationId" FROM public."Membership" m
  WHERE m."userId" = app.user_id() AND m."organizationId" = app.org_id()
$$;

-- D4: the caller's tier for later-phase policies (Phase 1 OrgIntegration
-- and OrgExport, Phase 4b can_view_rows): the Role of app.user_id() in
-- app.member_org_id(), or NULL. Same value as member_role(); this is the
-- stable name later phases cite.
CREATE OR REPLACE FUNCTION app.member_tier() RETURNS "Role"
LANGUAGE sql STABLE
AS $$ SELECT app.member_role() $$;

CREATE OR REPLACE FUNCTION app.is_org_admin() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app.member_role() IN ('OWNER', 'ADMIN'), false) $$;

CREATE OR REPLACE FUNCTION app.is_org_owner() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app.member_role() = 'OWNER', false) $$;

-- Finance authority: OWNER or TREASURER (guards.ts requireFinanceAccess).
CREATE OR REPLACE FUNCTION app.is_finance() RETURNS boolean
LANGUAGE sql STABLE
AS $$ SELECT coalesce(app.member_role() IN ('OWNER', 'TREASURER'), false) $$;

-- The org the CALLER is scoped to: the member org for app_user, the
-- service org for app_service, NULL for every other login role. The
-- owner-run helpers below refuse any other p_org (attack N3).
CREATE OR REPLACE FUNCTION app.caller_org() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT CASE session_user::text
           WHEN 'app_user' THEN app.member_org_id()
           WHEN 'app_service' THEN app.org_id()
         END
$$;

-- Does p_user have role p_role in p_org? (owner-run; membership_guard and
-- organization_guard only). Scoped to the caller's org.
CREATE OR REPLACE FUNCTION app.user_has_role(p_user text, p_org text, p_role "Role") RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_org IS NULL OR p_org IS DISTINCT FROM app.caller_org() THEN
    RAISE EXCEPTION 'user_has_role: not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public."Membership" m
                  WHERE m."userId" = p_user AND m."organizationId" = p_org AND m."role" = p_role);
END $$;



-- =====================================================================
-- Section 4. Privileged functions
-- Complete list of SECURITY DEFINER functions in this migration (N9).
-- All run as the table owner, bypassing RLS, with search_path pinned to
-- pg_catalog, public, pg_temp, and each checks the caller itself.
-- session_user is the login role (app roles log in directly; T31 shows
-- none can SET ROLE into another).
--   context:     member_role, member_org_id, user_has_role (Section 2)
--   outbox:      enqueue_job, claim_jobs, finish_job, cancel_job
--   rate limit:  rate_limit_hit
--   secrets:     secret_read, secret_write, secret_delete
--   lookups:     invitation_by_token_hash, pending_invitations_for_me,
--                poll_org_id, slug_available, active_org_ids
--   triggers:    org_has_members, org_has_other_owner, lock_org (helpers),
--                assert_same_org, assert_member_of_parent_org,
--                membership_history (trigger functions, Section 5)
--   credentials: set_ics_token_hash, ics_token_created_at
--   audit:       write_org_audit, write_finance_audit
--   identity:    purge_unverified_users
-- Everything else in schema app is SECURITY INVOKER.
-- Every 42501 raised here says '<function>: not permitted' and nothing
-- about other orgs' rows (attack N4).
-- =====================================================================

-- ---- Outbox --------------------------------------------------------
-- The only way to create a Job. Same transaction as the caller's write.
-- Coalescing: at most one PENDING/RUNNING row per (organizationId,
-- dedupeKey). A duplicate enqueue while PENDING merges into it (earliest
-- runAt, latest payload); while RUNNING it sets rerunRequested so
-- finish_job re-queues the row instead of losing the update. p_once =
-- true also refuses a key that already finished DONE in the same org
-- (daily digests). Callers:
--   app_user     p_org must be the member org
--   app_service  p_org must equal app.org_id() (NULL only with no org GUC)
--   app_auth     platform jobs only (p_org NULL)
--   app_legacy   strangler window: only notify-email / invite-email /
--                reimbursement-email, key '<kind>:<rowId>[:...]', where
--                rowId is a Notification / Invitation / Transaction of
--                p_org (the legacy email senders moved in 0B)
--   the owner    migrations, seed and reviewed ops scripts
--   anyone else  refused (attack N2)
CREATE OR REPLACE FUNCTION app.enqueue_job(
  p_org text, p_kind text, p_dedupe_key text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_run_at timestamp DEFAULT NULL,
  p_max_attempts integer DEFAULT 8,
  p_once boolean DEFAULT false
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id text;
  v_ref text;
  v_ref_org text;
BEGIN
  IF p_kind IS NULL OR p_dedupe_key IS NULL OR length(p_dedupe_key) > 300 THEN
    RAISE EXCEPTION 'enqueue_job: invalid arguments' USING ERRCODE = '22023';
  END IF;

  IF session_user = 'app_user' THEN
    IF p_org IS NULL OR p_org IS DISTINCT FROM app.member_org_id() THEN
      RAISE EXCEPTION 'enqueue_job: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user = 'app_service' THEN
    IF p_org IS DISTINCT FROM app.org_id() THEN
      RAISE EXCEPTION 'enqueue_job: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user = 'app_auth' THEN
    IF p_org IS NOT NULL THEN
      RAISE EXCEPTION 'enqueue_job: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user = 'app_legacy' THEN
    IF p_org IS NULL
       OR p_kind NOT IN ('notify-email', 'invite-email', 'reimbursement-email')
       OR left(p_dedupe_key, length(p_kind) + 1) <> p_kind || ':' THEN
      RAISE EXCEPTION 'enqueue_job: not permitted' USING ERRCODE = '42501';
    END IF;
    v_ref := split_part(p_dedupe_key, ':', 2);
    v_ref_org := CASE p_kind
      WHEN 'notify-email' THEN (SELECT n."organizationId" FROM public."Notification" n WHERE n."id" = v_ref)
      WHEN 'invite-email' THEN (SELECT i."organizationId" FROM public."Invitation" i WHERE i."id" = v_ref)
      WHEN 'reimbursement-email' THEN (SELECT t."organizationId" FROM public."Transaction" t WHERE t."id" = v_ref)
    END;
    IF v_ref_org IS DISTINCT FROM p_org THEN
      RAISE EXCEPTION 'enqueue_job: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user = current_user THEN
    NULL; -- the function owner: migrations, the seed, reviewed ops scripts
  ELSE
    RAISE EXCEPTION 'enqueue_job: not permitted' USING ERRCODE = '42501';
  END IF;

  IF p_once THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(p_org, '') || '|' || p_dedupe_key, 0));
    IF EXISTS (SELECT 1 FROM public."Job" j
                WHERE j."organizationId" IS NOT DISTINCT FROM p_org
                  AND j."dedupeKey" = p_dedupe_key AND j."status" = 'DONE') THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO public."Job" AS j ("organizationId", "kind", "dedupeKey", "payload", "runAt", "maxAttempts", "createdAt")
  VALUES (p_org, p_kind, p_dedupe_key, coalesce(p_payload, '{}'::jsonb),
          coalesce(p_run_at, app.utc_now()), p_max_attempts, app.utc_now())
  ON CONFLICT ("organizationId", "dedupeKey")
    WHERE ("status" = ANY (ARRAY['PENDING'::public."JobStatus", 'RUNNING'::public."JobStatus"]))
  DO UPDATE SET
    "payload" = EXCLUDED."payload",
    "runAt" = CASE WHEN j."status" = 'PENDING' THEN LEAST(j."runAt", EXCLUDED."runAt") ELSE j."runAt" END,
    "rerunRequested" = j."rerunRequested" OR j."status" = 'RUNNING'
  WHERE j."organizationId" IS NOT DISTINCT FROM EXCLUDED."organizationId"
    AND j."kind" = EXCLUDED."kind"
  RETURNING j."id" INTO v_id;
  IF v_id IS NULL THEN
    -- Same org and key but a different kind: a caller bug, never a merge.
    RAISE EXCEPTION 'enqueue_job: dedupe key already used by another kind' USING ERRCODE = '22023';
  END IF;
  RETURN v_id;
END $$;

-- Claim in a short transaction; the caller commits before any network I/O.
-- p_leases maps job kind -> lease seconds, taken from the job-kind
-- registry (src/server/jobs/registry.ts; the 'Background jobs' decision),
-- which asserts lease > maxRuntime for every kind.
CREATE OR REPLACE FUNCTION app.claim_jobs(p_leases jsonb, p_limit integer DEFAULT 10)
RETURNS SETOF public."Job"
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Leases that expired on their last allowed attempt go DEAD.
  UPDATE public."Job" SET "status" = 'DEAD', "lockToken" = NULL, "lockedUntil" = NULL,
         "lastError" = 'lease expired on final attempt', "completedAt" = app.utc_now()
   WHERE "status" = 'RUNNING' AND "lockedUntil" < app.utc_now() AND "attempts" >= "maxAttempts";

  RETURN QUERY
  WITH picked AS (
    SELECT j."id" FROM public."Job" j
     WHERE j."kind" IN (SELECT jsonb_object_keys(p_leases))
       AND ((j."status" = 'PENDING' AND j."runAt" <= app.utc_now())
         OR (j."status" = 'RUNNING' AND j."lockedUntil" < app.utc_now()))
     ORDER BY j."runAt"
     LIMIT p_limit
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public."Job" j
     SET "status" = 'RUNNING',
         "attempts" = j."attempts" + 1,
         "lockedUntil" = app.utc_now() + make_interval(secs => (p_leases ->> j."kind")::integer),
         "lockToken" = (gen_random_uuid())::text
    FROM picked
   WHERE j."id" = picked."id"
  RETURNING j.*;
END $$;

-- Second short transaction, compare-and-set on the lock token. Returns
-- false when the lease was lost (the result is discarded; side effects
-- are idempotent through their own CAS, e.g. Notification.emailSentAt).
-- p_error must already be sanitized by the caller; it is also truncated.
CREATE OR REPLACE FUNCTION app.finish_job(p_id text, p_lock_token text, p_outcome text, p_error text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_outcome NOT IN ('DONE', 'RETRY', 'DEAD', 'CANCELLED') THEN
    RAISE EXCEPTION 'finish_job: bad outcome %', p_outcome USING ERRCODE = '22023';
  END IF;
  UPDATE public."Job" j SET
    "status" = (CASE
      WHEN p_outcome = 'DONE' AND j."rerunRequested" THEN 'PENDING'
      WHEN p_outcome = 'DONE' THEN 'DONE'
      WHEN p_outcome = 'RETRY' AND j."attempts" < j."maxAttempts" THEN 'PENDING'
      WHEN p_outcome = 'RETRY' THEN 'DEAD'
      ELSE p_outcome END)::public."JobStatus",
    "runAt" = CASE
      WHEN p_outcome = 'DONE' AND j."rerunRequested" THEN app.utc_now()
      WHEN p_outcome = 'RETRY' THEN app.utc_now()
           + LEAST(make_interval(secs => 30 * power(2, greatest(j."attempts" - 1, 0))), interval '6 hours')
      ELSE j."runAt" END,
    "attempts" = CASE WHEN p_outcome = 'DONE' AND j."rerunRequested" THEN 0 ELSE j."attempts" END,
    "rerunRequested" = false,
    "lockToken" = NULL,
    "lockedUntil" = NULL,
    "lastError" = CASE WHEN p_error IS NULL THEN j."lastError" ELSE left(p_error, 500) END,
    "completedAt" = CASE
      WHEN (p_outcome = 'DONE' AND NOT j."rerunRequested")
        OR p_outcome IN ('DEAD', 'CANCELLED')
        OR (p_outcome = 'RETRY' AND j."attempts" >= j."maxAttempts") THEN app.utc_now()
      ELSE NULL END
  WHERE j."id" = p_id AND j."lockToken" = p_lock_token AND j."status" = 'RUNNING';
  RETURN FOUND;
END $$;

-- Cancel an active job by key (an OWNER cancels a scheduled purge, an
-- admin cancels a stuck sync). ADMIN+ or the service path only (D2): the
-- member path never cancels. A task due-date change enqueues a NEW
-- reminder key instead, and the reminder worker re-checks that the task
-- is still open with the same due date and owner, and no-ops otherwise.
CREATE OR REPLACE FUNCTION app.cancel_job(p_org text, p_dedupe_key text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF session_user = 'app_user' THEN
    IF NOT (p_org IS NOT NULL AND p_org = app.member_org_id() AND app.is_org_admin()) THEN
      RAISE EXCEPTION 'cancel_job: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user = 'app_service' THEN
    IF p_org IS DISTINCT FROM app.org_id() THEN
      RAISE EXCEPTION 'cancel_job: not permitted' USING ERRCODE = '42501';
    END IF;
  ELSIF session_user <> current_user THEN
    RAISE EXCEPTION 'cancel_job: not permitted' USING ERRCODE = '42501';
  END IF;
  UPDATE public."Job" SET "status" = 'CANCELLED', "completedAt" = app.utc_now(),
         "lockToken" = NULL, "lockedUntil" = NULL
   WHERE "dedupeKey" = p_dedupe_key AND "organizationId" IS NOT DISTINCT FROM p_org
     AND "status" = 'PENDING';
  RETURN FOUND;
END $$;

-- ---- Rate limiter ---------------------------------------------------
-- Fixed window. The TS wrapper calls this as its own autocommit
-- statement on serviceDb (or authDb for sign-in), never inside ctx.db,
-- so a rolled-back action still counts. EXECUTE is granted to
-- app_service and app_auth only (attack N6): request code cannot touch
-- another principal's bucket, such as a sign-in lockout key.
CREATE OR REPLACE FUNCTION app.rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
RETURNS TABLE (allowed boolean, retry_after_ms bigint)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_start timestamp(3) := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds)
                          AT TIME ZONE 'UTC';
  v_count integer;
BEGIN
  IF length(p_key) > 200 THEN
    RAISE EXCEPTION 'rate_limit_hit: key too long' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."RateLimitBucket" AS b ("key", "windowStart", "count")
  VALUES (p_key, v_start, 1)
  ON CONFLICT ("key") DO UPDATE SET
    "count" = CASE WHEN b."windowStart" = EXCLUDED."windowStart" THEN b."count" + 1 ELSE 1 END,
    "windowStart" = EXCLUDED."windowStart"
  RETURNING b."count" INTO v_count;
  allowed := v_count <= p_limit;
  retry_after_ms := CASE WHEN v_count <= p_limit THEN 0
    ELSE (extract(epoch FROM (v_start + make_interval(secs => p_window_seconds)) - app.utc_now()) * 1000)::bigint END;
  RETURN NEXT;
END $$;

-- ---- Secrets accessor (contract 3: OrgSecret has no table grants) ------
-- Names, signatures and grants match the Phase 1 plan (app.secret_read /
-- secret_write / secret_delete, EXECUTE for app_service only). Each call
-- must run inside withSystemOrgTx(orgId, { userId }) with app.org_id() =
-- p_org, after the calling action checked the permission through
-- permissions.ts (ADMIN+ to set or replace, OWNER to remove); the same
-- transaction writes the OrgAuditLog row. The p_org = app.org_id() check
-- is a consistency check, not an authorization boundary: any app_service
-- code sets its own GUC, so isolation relies on src/server/secrets being
-- the only caller (lint allowlist) plus review (N10).
CREATE OR REPLACE FUNCTION app.secret_read(p_org text, p_integration text, p_kind text)
RETURNS TABLE ("id" text, "ciphertext" bytea, "iv" bytea, "authTag" bytea,
               "wrappedDek" bytea, "dekIv" bytea, "dekTag" bytea, "kekVersion" integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF app.org_id() IS NULL OR p_org IS DISTINCT FROM app.org_id() THEN
    RAISE EXCEPTION 'secret_read: not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT s."id", s."ciphertext", s."iv", s."authTag", s."wrappedDek", s."dekIv", s."dekTag", s."kekVersion"
    FROM public."OrgSecret" s
   WHERE s."organizationId" = p_org AND s."integrationId" = p_integration AND s."kind" = p_kind;
END $$;

CREATE OR REPLACE FUNCTION app.secret_write(
  p_org text, p_integration text, p_kind text,
  p_ciphertext bytea, p_iv bytea, p_auth_tag bytea,
  p_wrapped_dek bytea, p_dek_iv bytea, p_dek_tag bytea, p_kek_version integer
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id text;
BEGIN
  IF app.org_id() IS NULL OR p_org IS DISTINCT FROM app.org_id() THEN
    RAISE EXCEPTION 'secret_write: not permitted' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public."OrgSecret" AS s ("organizationId", "integrationId", "kind", "ciphertext", "iv", "authTag",
                                       "wrappedDek", "dekIv", "dekTag", "kekVersion", "createdById", "createdAt")
  VALUES (p_org, p_integration, p_kind, p_ciphertext, p_iv, p_auth_tag,
          p_wrapped_dek, p_dek_iv, p_dek_tag, p_kek_version, app.user_id(), app.utc_now())
  ON CONFLICT ("organizationId", "integrationId", "kind") DO UPDATE SET
    "ciphertext" = EXCLUDED."ciphertext", "iv" = EXCLUDED."iv", "authTag" = EXCLUDED."authTag",
    "wrappedDek" = EXCLUDED."wrappedDek", "dekIv" = EXCLUDED."dekIv", "dekTag" = EXCLUDED."dekTag",
    "kekVersion" = EXCLUDED."kekVersion", "createdById" = EXCLUDED."createdById", "createdAt" = EXCLUDED."createdAt"
  WHERE s."organizationId" = EXCLUDED."organizationId"
  RETURNING s."id" INTO v_id;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'secret_write: not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.secret_delete(p_org text, p_integration text, p_kind text) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF app.org_id() IS NULL OR p_org IS DISTINCT FROM app.org_id() THEN
    RAISE EXCEPTION 'secret_delete: not permitted' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."OrgSecret"
   WHERE "organizationId" = p_org AND "integrationId" = p_integration AND "kind" = p_kind;
  RETURN FOUND;
END $$;

-- ---- Cross-org lookups for the enumerated no-context paths ----------
-- Invite link: token hash -> the invite, before the user is a member.
CREATE OR REPLACE FUNCTION app.invitation_by_token_hash(p_hash text)
RETURNS TABLE ("id" text, "organizationId" text, "email" text, "role" "Role",
               "expiresAt" timestamp(3), "acceptedAt" timestamp(3), "invitedById" text,
               "orgName" text, "orgSlug" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT i."id", i."organizationId", i."email", i."role", i."expiresAt", i."acceptedAt", i."invitedById",
         o."name", o."slug"
    FROM public."Invitation" i JOIN public."Organization" o ON o."id" = i."organizationId"
   WHERE i."token" = p_hash
$$;

-- Onboarding "Join": pending invites for the caller's verified email.
CREATE OR REPLACE FUNCTION app.pending_invitations_for_me()
RETURNS TABLE ("id" text, "organizationId" text, "role" "Role", "expiresAt" timestamp(3),
               "orgName" text, "orgSlug" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT i."id", i."organizationId", i."role", i."expiresAt", o."name", o."slug"
    FROM public."Invitation" i
    JOIN public."Organization" o ON o."id" = i."organizationId"
    JOIN public."User" u ON u."id" = app.user_id()
   WHERE u."emailVerified" IS NOT NULL
     AND i."email" = u."email" AND i."acceptedAt" IS NULL AND i."expiresAt" > app.utc_now()
$$;

-- Public poll page / submit: poll id -> org id, then withSystemOrgTx(org).
CREATE OR REPLACE FUNCTION app.poll_org_id(p_poll text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT p."organizationId" FROM public."AvailabilityPoll" p WHERE p."id" = p_poll $$;

-- Onboarding slug check. Phase 1 replaces this body to also check
-- OrgSlugHistory (permanently reserved old slugs) and the reserved words.
CREATE OR REPLACE FUNCTION app.slug_available(p_slug text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT NOT EXISTS (SELECT 1 FROM public."Organization" o WHERE o."slug" = p_slug) $$;

-- Crons enumerate orgs, then run withSystemOrgTx(orgId) per org.
CREATE OR REPLACE FUNCTION app.active_org_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$ SELECT o."id" FROM public."Organization" o ORDER BY o."id" $$;

-- ---- Owner-run helpers for the privilege triggers --------------------
-- Called only from membership_guard (SECURITY INVOKER, so the runtime
-- role needs EXECUTE). Each refuses any org but the caller's (N3).
CREATE OR REPLACE FUNCTION app.org_has_members(p_org text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_org IS NULL OR p_org IS DISTINCT FROM app.caller_org() THEN
    RAISE EXCEPTION 'org_has_members: not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public."Membership" m WHERE m."organizationId" = p_org);
END $$;

CREATE OR REPLACE FUNCTION app.org_has_other_owner(p_org text, p_user text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_org IS NULL OR p_org IS DISTINCT FROM app.caller_org() THEN
    RAISE EXCEPTION 'org_has_other_owner: not permitted' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (SELECT 1 FROM public."Membership" m
                  WHERE m."organizationId" = p_org AND m."role" = 'OWNER' AND m."userId" <> p_user);
END $$;

-- Serializes OWNER changes per org so two owners cannot demote each other
-- concurrently and leave zero owners.
CREATE OR REPLACE FUNCTION app.lock_org(p_org text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_org IS NULL OR p_org IS DISTINCT FROM app.caller_org() THEN
    RAISE EXCEPTION 'lock_org: not permitted' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('org-owners:' || p_org, 0));
END $$;

-- ---- Credentials (D3) -------------------------------------------------
-- The caller's own ICS feed token. Keyed on app.user_id(), so request
-- code reaches only its own UserCredential row; the plaintext token never
-- reaches the database. Granted to app_user and app_legacy: from 0B the
-- legacy settings/calendar actions (getOrCreateIcsToken,
-- regenerateIcsToken) call these in a legacyDb transaction that first
-- runs app.set_context(userId, NULL), so 0B keeps 'no behaviour change'.
CREATE OR REPLACE FUNCTION app.set_ics_token_hash(p_hash text) RETURNS timestamp(3)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user text := app.user_id();
  v_at timestamp(3) := app.utc_now();
BEGIN
  IF v_user IS NULL OR session_user NOT IN ('app_user', 'app_legacy') THEN
    RAISE EXCEPTION 'set_ics_token_hash: not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'set_ics_token_hash: expected a sha256 hex digest' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."UserCredential" AS c ("userId", "icsTokenHash", "icsTokenCreatedAt", "updatedAt")
  VALUES (v_user, p_hash, v_at, v_at)
  ON CONFLICT ("userId") DO UPDATE SET
    "icsTokenHash" = EXCLUDED."icsTokenHash",
    "icsTokenCreatedAt" = EXCLUDED."icsTokenCreatedAt",
    "updatedAt" = EXCLUDED."updatedAt";
  RETURN v_at;
END $$;

-- 'Feed active since <date>', or NULL when the caller has no feed link.
CREATE OR REPLACE FUNCTION app.ics_token_created_at() RETURNS timestamp(3)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c."icsTokenCreatedAt" FROM public."UserCredential" c
   WHERE c."userId" = app.user_id() AND c."icsTokenHash" IS NOT NULL
     AND session_user IN ('app_user', 'app_legacy')
$$;

-- ---- Audit (N5) ---------------------------------------------------------
-- The only INSERT path into OrgAuditLog and FinanceAuditLog for app_user
-- and app_service (neither has INSERT on the tables). The database fixes
-- the id, actorId (= app.user_id()), organizationId (= the caller's org)
-- and createdAt (no backdating), and bounds action and diff size. The
-- content itself is still the caller's; writeOrgAuditLog and
-- writeFinanceAuditLog (src/server/audit) are the only callers.
-- app_legacy keeps its direct FinanceAuditLog INSERT (append-only) until
-- the 0C finance PR.
CREATE OR REPLACE FUNCTION app.write_org_audit(
  p_org text, p_action text, p_target_type text DEFAULT NULL, p_target_id text DEFAULT NULL,
  p_diff jsonb DEFAULT '{}'::jsonb
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id text := (gen_random_uuid())::text;
BEGIN
  IF p_org IS NULL OR p_org IS DISTINCT FROM app.caller_org() THEN
    RAISE EXCEPTION 'write_org_audit: not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action !~ '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'
     OR octet_length(coalesce(p_diff, '{}'::jsonb)::text) > 65536 THEN
    RAISE EXCEPTION 'write_org_audit: invalid entry' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public."OrgAuditLog" ("id", "organizationId", "actorId", "action", "targetType", "targetId", "diffJson", "createdAt")
  VALUES (v_id, p_org, app.user_id(), p_action, left(p_target_type, 64), left(p_target_id, 128),
          coalesce(p_diff, '{}'::jsonb), app.utc_now());
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION app.write_finance_audit(
  p_org text, p_action text, p_transaction_id text DEFAULT NULL, p_sponsorship_id text DEFAULT NULL,
  p_diff jsonb DEFAULT '{}'::jsonb
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id text := (gen_random_uuid())::text;
BEGIN
  IF p_org IS NULL OR p_org IS DISTINCT FROM app.caller_org() OR app.user_id() IS NULL THEN
    RAISE EXCEPTION 'write_finance_audit: not permitted' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action !~ '^[A-Za-z][A-Za-z0-9_.:-]{0,79}$'
     OR octet_length(coalesce(p_diff, '{}'::jsonb)::text) > 65536 THEN
    RAISE EXCEPTION 'write_finance_audit: invalid entry' USING ERRCODE = '22023';
  END IF;
  -- same_org_refs on FinanceAuditLog still checks the two references.
  INSERT INTO public."FinanceAuditLog" ("id", "organizationId", "actorId", "transactionId", "sponsorshipId",
                                        "action", "diffJson", "createdAt")
  VALUES (v_id, p_org, app.user_id(), p_transaction_id, p_sponsorship_id, p_action,
          coalesce(p_diff, '{}'::jsonb), app.utc_now());
  RETURN v_id;
END $$;

-- ---- Identity: the 0A unverified-account purge ------------------------
-- app_auth has no tenant access, so the 'no Membership' predicate of the
-- 0A daily purge (Fix 4(d)) is evaluated here, as the owner. Deletes
-- credential sign-ups whose email was never verified and that have no
-- Account, no Membership and no OrgMemberHistory row:
--   p_email NULL   the daily job, users older than 72 hours;
--   p_email given  the Auth.js signIn callback, right before a verified
--                  Google sign-in for that address links or creates.
-- Returns the number of users deleted. app_auth only.
CREATE OR REPLACE FUNCTION app.purge_unverified_users(p_email text DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_n integer;
BEGIN
  IF session_user <> 'app_auth' AND session_user <> current_user THEN
    RAISE EXCEPTION 'purge_unverified_users: not permitted' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public."User" u
   WHERE u."emailVerified" IS NULL
     AND CASE WHEN p_email IS NULL THEN u."createdAt" < app.utc_now() - interval '72 hours'
              ELSE u."email" = lower(btrim(p_email)) END
     AND NOT EXISTS (SELECT 1 FROM public."Account" a WHERE a."userId" = u."id")
     AND NOT EXISTS (SELECT 1 FROM public."Membership" m WHERE m."userId" = u."id")
     AND NOT EXISTS (SELECT 1 FROM public."OrgMemberHistory" h WHERE h."userId" = u."id");
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;


-- =====================================================================
-- Section 5. Triggers
-- same_org_refs, member_of_parent_org and immutable_cols fire for every
-- runtime role, app_legacy included (FK checks bypass RLS). The
-- privilege triggers (membership_guard, organization_guard,
-- transaction_guard) bind app_user and app_service only: the owner is
-- exempt (migrations, FK cascades run as the owner) and so is app_legacy
-- during the strangler window (see the header).
-- =====================================================================

-- 5a. Same-org references. TG_ARGV = (fk column, parent table) pairs.
-- SECURITY DEFINER so the parent lookup is not filtered by the caller's
-- RLS. A missing parent and a parent in another org raise the SAME error
-- (23503 'invalid reference: <table>.<column>'), so the reply never says
-- whether another org's id exists (attack N4).
CREATE OR REPLACE FUNCTION app.assert_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  i integer := 0;
  v_col text;
  v_parent text;
  v_ref text;
  v_parent_org text;
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
BEGIN
  WHILE i < TG_NARGS LOOP
    v_col := TG_ARGV[i];
    v_parent := TG_ARGV[i + 1];
    i := i + 2;
    v_ref := v_new ->> v_col;
    CONTINUE WHEN v_ref IS NULL;
    CONTINUE WHEN TG_OP = 'UPDATE'
      AND v_ref IS NOT DISTINCT FROM (v_old ->> v_col)
      AND (v_new ->> 'organizationId') IS NOT DISTINCT FROM (v_old ->> 'organizationId');
    v_parent_org := NULL;
    EXECUTE format('SELECT "organizationId" FROM public.%I WHERE "id" = $1', v_parent)
      INTO v_parent_org USING v_ref;
    IF v_parent_org IS NULL OR v_parent_org IS DISTINCT FROM (v_new ->> 'organizationId') THEN
      RAISE EXCEPTION 'invalid reference: %.%', TG_TABLE_NAME, v_col USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org(
    'budgetPeriodId', 'BudgetPeriod', 'categoryId', 'BudgetCategory', 'eventId', 'Event', 'taskId', 'Task');
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "Note"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('eventId', 'Event');
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "Task"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('projectId', 'Project', 'parentTaskId', 'Task');
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "Sponsorship"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org(
    'sponsorId', 'Sponsor', 'budgetPeriodId', 'BudgetPeriod', 'transactionId', 'Transaction');
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "BudgetCategory"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('budgetPeriodId', 'BudgetPeriod');
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "AvailabilityPoll"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('finalizedEventId', 'Event');
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "FinanceAuditLog"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('transactionId', 'Transaction', 'sponsorshipId', 'Sponsorship');

-- 5b. A user attached to a task or event must be a member of its org
-- (the bulkAssign and finalizePoll class, on every path). For app_user
-- and app_service a parent outside the caller's org gets the same
-- 'invalid reference' as a missing parent (N4); a same-org parent with a
-- non-member user gets 23514.
CREATE OR REPLACE FUNCTION app.assert_member_of_parent_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_ref text := to_jsonb(NEW) ->> TG_ARGV[0];
  v_org text;
BEGIN
  EXECUTE format('SELECT "organizationId" FROM public.%I WHERE "id" = $1', TG_ARGV[1])
    INTO v_org USING v_ref;
  IF v_org IS NULL
     OR (session_user IN ('app_user', 'app_service') AND v_org IS DISTINCT FROM app.caller_org()) THEN
    RAISE EXCEPTION 'invalid reference: %.%', TG_TABLE_NAME, TG_ARGV[0] USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
       SELECT 1 FROM public."Membership" m WHERE m."userId" = NEW."userId" AND m."organizationId" = v_org) THEN
    RAISE EXCEPTION '%: user is not a member of this organization', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER member_of_parent_org BEFORE INSERT OR UPDATE OF "userId", "taskId" ON "TaskAssignee"
  FOR EACH ROW EXECUTE FUNCTION app.assert_member_of_parent_org('taskId', 'Task');
CREATE TRIGGER member_of_parent_org BEFORE INSERT OR UPDATE OF "userId", "eventId" ON "EventAttendee"
  FOR EACH ROW EXECUTE FUNCTION app.assert_member_of_parent_org('eventId', 'Event');

-- 5c. Membership privilege rules (contract 2). SECURITY INVOKER on
-- purpose: current_user is the runtime role for app requests, and the
-- table owner inside FK cascades (Postgres runs RI actions as the owner),
-- so an org purge or user deletion is not blocked by the last-owner rule.
-- app_legacy is exempt until its 0C PR; 0A Fix 3 enforces the same rules
-- in app code on that path.
CREATE OR REPLACE FUNCTION app.membership_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org text := CASE WHEN TG_OP = 'DELETE' THEN OLD."organizationId" ELSE NEW."organizationId" END;
  v_granting boolean := false;
  v_removing boolean := false;
BEGIN
  IF current_user NOT IN ('app_user', 'app_service') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW."userId" IS DISTINCT FROM OLD."userId"
                           OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") THEN
    RAISE EXCEPTION 'Membership.userId and organizationId are immutable' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_granting := NEW."role" = 'OWNER';
  ELSIF TG_OP = 'UPDATE' THEN
    v_granting := NEW."role" = 'OWNER' AND OLD."role" <> 'OWNER';
    v_removing := OLD."role" = 'OWNER' AND NEW."role" <> 'OWNER';
  ELSE
    v_removing := OLD."role" = 'OWNER';
  END IF;

  IF v_granting OR v_removing THEN
    PERFORM app.lock_org(v_org);
    IF NOT (
         app.user_has_role(app.user_id(), v_org, 'OWNER')
         -- Bootstrap: the creator of a brand-new org becomes its OWNER.
         OR (TG_OP = 'INSERT' AND NEW."userId" = app.user_id() AND NOT app.org_has_members(v_org))
       ) THEN
      RAISE EXCEPTION 'only an OWNER can grant or remove the OWNER role' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_removing AND NOT app.org_has_other_owner(v_org, OLD."userId") THEN
    RAISE EXCEPTION 'an organization must keep at least one OWNER' USING ERRCODE = '23514';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

CREATE TRIGGER membership_guard BEFORE INSERT OR UPDATE OR DELETE ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION app.membership_guard();

-- 5d. Membership history for "User" visibility.
CREATE OR REPLACE FUNCTION app.membership_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public."OrgMemberHistory" ("organizationId", "userId", "firstJoinedAt", "lastJoinedAt", "leftAt")
    VALUES (NEW."organizationId", NEW."userId", app.utc_now(), app.utc_now(), NULL)
    ON CONFLICT ("organizationId", "userId") DO UPDATE SET "lastJoinedAt" = EXCLUDED."lastJoinedAt", "leftAt" = NULL;
    RETURN NEW;
  END IF;
  UPDATE public."OrgMemberHistory" SET "leftAt" = app.utc_now()
   WHERE "organizationId" = OLD."organizationId" AND "userId" = OLD."userId";
  RETURN OLD;
END $$;

CREATE TRIGGER membership_history AFTER INSERT OR DELETE ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION app.membership_history();

-- 5e. Organization privilege columns (contract 2). Uses to_jsonb so the
-- Phase 1 columns (deletedAt, deleteScheduledFor) are covered as soon as
-- they exist, without editing this function; Phase 1 does not extend it.
-- Phase 1's OrgSettings gets admin-only per-command policies; its own
-- OWNER-only fields, if any, use app.is_org_owner() or app.member_tier().
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
  FOREACH k IN ARRAY ARRAY['slug', 'deletedAt', 'deleteScheduledFor'] LOOP
    IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k)
       AND NOT app.user_has_role(app.user_id(), OLD."id", 'OWNER') THEN
      RAISE EXCEPTION 'only an OWNER can change Organization.%', k USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER organization_guard BEFORE UPDATE ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION app.organization_guard();

-- 5f. Transaction separation of duties (attack B2), mirroring
-- reimbursement-state-machine.ts: self-approval is blocked across the
-- board (approve, reject, reimburse). RLS cannot compare NEW with OLD, so
-- this is a BEFORE INSERT OR UPDATE trigger:
--   * submittedById, kind and organizationId are immutable;
--   * approvedById, when set or changed to a value, must be the actor
--     (app.user_id()) and never the submitter;
--   * reconciledById, when set or changed to a value, must be the actor;
--   * reimbursedAt going from NULL to a value, and status moving to
--     APPROVED, REJECTED or REIMBURSED, need an actor who is not the
--     submitter.
-- An INSERT is checked as a change from an empty row, so a finance user
-- cannot create an already-approved expense either. No actor (a service
-- job without a user) can do none of these. The finance-role and
-- open-status rules stay in the RLS policies (6.10).
CREATE OR REPLACE FUNCTION app.transaction_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor text := app.user_id();
  v_ins boolean := TG_OP = 'INSERT';
BEGIN
  IF current_user NOT IN ('app_user', 'app_service') THEN
    RETURN NEW;
  END IF;
  IF NOT v_ins AND (NEW."submittedById" IS DISTINCT FROM OLD."submittedById"
                    OR NEW."kind" IS DISTINCT FROM OLD."kind"
                    OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId") THEN
    RAISE EXCEPTION 'Transaction.submittedById, kind and organizationId are immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW."approvedById" IS NOT NULL
     AND (v_ins OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById")
     AND (v_actor IS NULL OR NEW."approvedById" <> v_actor OR v_actor = NEW."submittedById") THEN
    RAISE EXCEPTION 'Transaction: approvedById must be the acting user, who is not the submitter' USING ERRCODE = '42501';
  END IF;
  IF NEW."reconciledById" IS NOT NULL
     AND (v_ins OR NEW."reconciledById" IS DISTINCT FROM OLD."reconciledById")
     AND (v_actor IS NULL OR NEW."reconciledById" <> v_actor) THEN
    RAISE EXCEPTION 'Transaction: reconciledById must be the acting user' USING ERRCODE = '42501';
  END IF;
  IF NEW."reimbursedAt" IS NOT NULL AND (v_ins OR OLD."reimbursedAt" IS NULL)
     AND (v_actor IS NULL OR v_actor = NEW."submittedById") THEN
    RAISE EXCEPTION 'Transaction: the submitter cannot mark their own expense reimbursed' USING ERRCODE = '42501';
  END IF;
  IF NEW."status" IN ('APPROVED', 'REJECTED', 'REIMBURSED')
     AND (v_ins OR NEW."status" IS DISTINCT FROM OLD."status")
     AND (v_actor IS NULL OR v_actor = NEW."submittedById") THEN
    RAISE EXCEPTION 'Transaction: the submitter cannot approve, reject or reimburse their own expense' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER transaction_guard BEFORE INSERT OR UPDATE ON "Transaction"
  FOR EACH ROW EXECUTE FUNCTION app.transaction_guard();

-- 5g. Authorship is immutable (attack N5): TG_ARGV lists the columns.
-- Fires for every runtime role, app_legacy included (no Phase 0-6 code
-- rewrites these columns; grep-verified). INSERT policies pin the same
-- columns to app.user_id() for app_user (Section 6).
CREATE OR REPLACE FUNCTION app.immutable_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  k text;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF current_user NOT IN ('app_user', 'app_service', 'app_legacy') THEN
    RETURN NEW;
  END IF;
  v_new := to_jsonb(NEW);
  v_old := to_jsonb(OLD);
  FOREACH k IN ARRAY TG_ARGV LOOP
    IF (v_new -> k) IS DISTINCT FROM (v_old -> k) THEN
      RAISE EXCEPTION '%.% is immutable', TG_TABLE_NAME, k USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE TRIGGER immutable_cols BEFORE UPDATE OF "authorId" ON "Note"
  FOR EACH ROW EXECUTE FUNCTION app.immutable_columns('authorId');
CREATE TRIGGER immutable_cols BEFORE UPDATE OF "createdById" ON "Event"
  FOR EACH ROW EXECUTE FUNCTION app.immutable_columns('createdById');
CREATE TRIGGER immutable_cols BEFORE UPDATE OF "createdById" ON "Task"
  FOR EACH ROW EXECUTE FUNCTION app.immutable_columns('createdById');
CREATE TRIGGER immutable_cols BEFORE UPDATE OF "createdById" ON "AvailabilityPoll"
  FOR EACH ROW EXECUTE FUNCTION app.immutable_columns('createdById');


-- =====================================================================
-- Section 6. Row-level security: ENABLE on every table in public.
-- app_user and app_service get separate FOR SELECT / INSERT / UPDATE /
-- DELETE policies (a command with no policy for a role is denied).
-- app_auth (identity tables) and app_legacy (strangler window) use FOR
-- ALL policies. OrgSecret and RateLimitBucket have RLS enabled and NO
-- policies: they are reached only through definer functions.
-- Policy names: <role>_<command>.  UT = user tenant, ST = service tenant.
--   UT: "organizationId" = (SELECT app.member_org_id())
--   ST: (SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())
-- The (SELECT ...) wrappers make each helper an initplan, evaluated once
-- per statement rather than once per row.
-- =====================================================================
ALTER TABLE "User"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VerificationToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserCredential"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invitation"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Task"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Label"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Note"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Event"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AvailabilityPoll"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BudgetPeriod"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BudgetCategory"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Transaction"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sponsor"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Sponsorship"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceAuditLog"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskAssignee"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskLabel"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventAttendee"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PollSlot"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PollResponse"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Receipt"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Job"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgAuditLog"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RateLimitBucket"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgMemberHistory"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgSecret"         ENABLE ROW LEVEL SECURITY;

-- ---- 6.1 Identity tables --------------------------------------------
-- "User": self, or anyone who is or was a member of the current org. The
-- OrgMemberHistory subquery runs under the caller's own RLS (its policy
-- is the same org check), uncorrelated, so it is one hashed subplan per
-- statement and needs no definer helper (N3).
CREATE POLICY app_user_select ON "User" FOR SELECT TO app_user
  USING ("id" = (SELECT app.user_id())
         OR "id" IN (SELECT h."userId" FROM "OrgMemberHistory" h
                      WHERE h."organizationId" = (SELECT app.member_org_id())));
CREATE POLICY app_user_update ON "User" FOR UPDATE TO app_user
  USING ("id" = (SELECT app.user_id()))
  WITH CHECK ("id" = (SELECT app.user_id()));
-- (No INSERT/DELETE for app_user. UPDATE is further limited to the
--  profile columns by a column-level GRANT in Section 7.)
CREATE POLICY app_service_select ON "User" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL
         AND "id" IN (SELECT h."userId" FROM "OrgMemberHistory" h
                       WHERE h."organizationId" = (SELECT app.org_id())));

-- app_auth owns the identity plane: all rows, all commands.
CREATE POLICY app_auth_all ON "User"              FOR ALL TO app_auth USING (true) WITH CHECK (true);
CREATE POLICY app_auth_all ON "Account"           FOR ALL TO app_auth USING (true) WITH CHECK (true);
CREATE POLICY app_auth_all ON "Session"           FOR ALL TO app_auth USING (true) WITH CHECK (true);
CREATE POLICY app_auth_all ON "VerificationToken" FOR ALL TO app_auth USING (true) WITH CHECK (true);
CREATE POLICY app_auth_all ON "UserCredential"    FOR ALL TO app_auth USING (true) WITH CHECK (true);

-- ---- 6.2 Organization -----------------------------------------------
CREATE POLICY app_user_select ON "Organization" FOR SELECT TO app_user
  USING ("id" IN (SELECT m."organizationId" FROM "Membership" m WHERE m."userId" = (SELECT app.user_id())));
CREATE POLICY app_user_update ON "Organization" FOR UPDATE TO app_user
  USING ("id" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("id" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
-- No app_user INSERT (org creation is a service path) or DELETE (purge job).
CREATE POLICY app_service_select ON "Organization" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "id" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Organization" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "id" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Organization" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "id" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "id" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Organization" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "id" = (SELECT app.org_id()));

-- ---- 6.3 Membership --------------------------------------------------
-- D6: memberships are CREATED only on the service path (invite acceptance
-- and org creation, both by the joining user; 6.12). app_user has no
-- INSERT grant or policy (attack B3). Role changes are admin-only; OWNER
-- rules live in membership_guard.
CREATE POLICY app_user_select ON "Membership" FOR SELECT TO app_user
  USING ("userId" = (SELECT app.user_id()) OR "organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "Membership" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
-- Admins remove members; any member may leave (the trigger keeps an OWNER).
CREATE POLICY app_user_delete ON "Membership" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_org_admin()) OR "userId" = (SELECT app.user_id())));

-- ---- 6.4 Invitation (admin-only; never an OWNER invite) --------------
CREATE POLICY app_user_select ON "Invitation" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_insert ON "Invitation" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()) AND "role" <> 'OWNER');
CREATE POLICY app_user_update ON "Invitation" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()) AND "role" <> 'OWNER');
CREATE POLICY app_user_delete ON "Invitation" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));

-- ---- 6.5 Notification (recipient-owned; recipient must be a member) ---
-- The recipient check reads Membership under the caller's own RLS, which
-- shows every membership row of the caller's org.
CREATE POLICY app_user_select ON "Notification" FOR SELECT TO app_user
  USING ("userId" = (SELECT app.user_id()));
CREATE POLICY app_user_insert ON "Notification" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND EXISTS (SELECT 1 FROM "Membership" m
                           WHERE m."userId" = "Notification"."userId"
                             AND m."organizationId" = "Notification"."organizationId"));
CREATE POLICY app_user_update ON "Notification" FOR UPDATE TO app_user
  USING ("userId" = (SELECT app.user_id()))
  WITH CHECK ("userId" = (SELECT app.user_id()));
CREATE POLICY app_service_insert ON "Notification" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())
              AND EXISTS (SELECT 1 FROM "Membership" m
                           WHERE m."userId" = "Notification"."userId"
                             AND m."organizationId" = "Notification"."organizationId"));

-- ---- 6.6 Plain tenant tables: members read and write ----------------
-- Project, Task, Label, AvailabilityPoll: member-level for all commands
-- (Phase 6 tightens Task edits). Task and AvailabilityPoll INSERTs pin
-- createdById to the actor (N5); immutable_cols keeps it.
CREATE POLICY app_user_select ON "Project" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Project" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "Project" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "Project" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()));

CREATE POLICY app_user_select ON "Task" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Task" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "Task" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "Task" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()));

CREATE POLICY app_user_select ON "Label" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Label" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "Label" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "Label" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()));

CREATE POLICY app_user_select ON "AvailabilityPoll" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "AvailabilityPoll" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "AvailabilityPoll" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "AvailabilityPoll" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()));

-- ---- 6.7 Event: edit/delete by creator or OWNER/ADMIN (0A Fix 8) -----
CREATE POLICY app_user_select ON "Event" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Event" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "Event" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "Event" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));

-- ---- 6.8 Note: PRIVATE notes are visible only to their author; edits
-- and deletes by the author or OWNER/ADMIN (notes/actions.ts canEditNote).
CREATE POLICY app_user_select ON "Note" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("visibility" = 'ORGANIZATION' OR "authorId" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "Note" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "authorId" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "Note" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("visibility" = 'ORGANIZATION' OR "authorId" = (SELECT app.user_id()))
         AND ("authorId" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
         AND ("visibility" = 'ORGANIZATION' OR "authorId" = (SELECT app.user_id())));
CREATE POLICY app_user_delete ON "Note" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("visibility" = 'ORGANIZATION' OR "authorId" = (SELECT app.user_id()))
         AND ("authorId" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));

-- ---- 6.9 Finance configuration: writes need OWNER or TREASURER -------
CREATE POLICY app_user_select ON "BudgetPeriod" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "BudgetPeriod" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));
CREATE POLICY app_user_update ON "BudgetPeriod" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));
CREATE POLICY app_user_delete ON "BudgetPeriod" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));

CREATE POLICY app_user_select ON "BudgetCategory" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "BudgetCategory" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));
CREATE POLICY app_user_update ON "BudgetCategory" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));
CREATE POLICY app_user_delete ON "BudgetCategory" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));

CREATE POLICY app_user_select ON "Sponsor" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Sponsor" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));
CREATE POLICY app_user_update ON "Sponsor" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));
CREATE POLICY app_user_delete ON "Sponsor" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));

CREATE POLICY app_user_select ON "Sponsorship" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Sponsorship" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));
CREATE POLICY app_user_update ON "Sponsorship" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));
CREATE POLICY app_user_delete ON "Sponsorship" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_finance()));

-- ---- 6.10 Transaction: submitters edit their own open expenses; no hard
-- deletes (void instead). Separation of duties against the ACTOR is the
-- transaction_guard trigger (5f); these policies keep the role and
-- open-status rules of reimbursement-state-machine.ts.
CREATE POLICY app_user_select ON "Transaction" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Transaction" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND "submittedById" = (SELECT app.user_id())
              AND ("kind" = 'EXPENSE' OR (SELECT app.is_finance()))
              AND ("approvedById" IS NULL OR "approvedById" <> "submittedById"));
CREATE POLICY app_user_update ON "Transaction" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_finance())
              OR ("submittedById" = (SELECT app.user_id()) AND "status" IN ('DRAFT', 'SUBMITTED'))))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("approvedById" IS NULL OR "approvedById" <> "submittedById")
              AND ((SELECT app.is_finance())
                   OR ("submittedById" = (SELECT app.user_id()) AND "kind" = 'EXPENSE'
                       AND "status" IN ('DRAFT', 'SUBMITTED', 'NOT_APPLICABLE')
                       AND "approvedById" IS NULL AND "reimbursedAt" IS NULL AND "reconciledAt" IS NULL)));

-- ---- 6.11 Audit logs: append-only, readable per 0B ----------------------
-- No INSERT/UPDATE/DELETE grant for app_user or app_service: rows are
-- written through app.write_finance_audit / app.write_org_audit (N5).
CREATE POLICY app_user_select ON "FinanceAuditLog" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));

-- ---- 6.12 Service policies for the org-keyed tables ------------------
-- Fail-closed (contract 3): no org GUC, no rows. A service-path
-- Membership INSERT (invite acceptance, org creation) is for the joining
-- user only: userId = app.user_id() (D6).
CREATE POLICY app_service_select ON "Membership" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Membership" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_service_update ON "Membership" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Membership" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "Invitation" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Invitation" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()) AND "role" <> 'OWNER');
CREATE POLICY app_service_update ON "Invitation" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()) AND "role" <> 'OWNER');
CREATE POLICY app_service_delete ON "Invitation" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "Notification" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Notification" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Notification" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "Project" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Project" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Project" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Project" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "Task" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Task" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Task" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Task" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "Label" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Label" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Label" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Label" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "Note" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Note" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Note" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Note" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "Event" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Event" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Event" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Event" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "AvailabilityPoll" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "AvailabilityPoll" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "AvailabilityPoll" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "AvailabilityPoll" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "BudgetPeriod" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "BudgetPeriod" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "BudgetPeriod" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "BudgetPeriod" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "BudgetCategory" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "BudgetCategory" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "BudgetCategory" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "BudgetCategory" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "Transaction" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Transaction" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Transaction" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
-- (No DELETE on Transaction for any runtime role.)

CREATE POLICY app_service_select ON "Sponsor" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Sponsor" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Sponsor" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Sponsor" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "Sponsorship" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Sponsorship" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Sponsorship" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Sponsorship" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_service_select ON "FinanceAuditLog" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- ---- 6.13 Legacy child tables: EXISTS on the parent, for BOTH roles --
-- The parent's own RLS applies inside the subquery for the invoking role,
-- so these inherit tenant scoping (and fail closed for app_service with no
-- org GUC). Parent indexes: TaskAssignee/TaskLabel/EventAttendee PKs lead
-- with the parent id; PollSlot_pollId_idx, PollResponse_pollId_idx and
-- Receipt_transactionId_idx exist.
CREATE POLICY parent_scoped_select ON "TaskAssignee" FOR SELECT TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskAssignee"."taskId"));
CREATE POLICY parent_scoped_insert ON "TaskAssignee" FOR INSERT TO app_user, app_service
  WITH CHECK (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskAssignee"."taskId"));
CREATE POLICY parent_scoped_update ON "TaskAssignee" FOR UPDATE TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskAssignee"."taskId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskAssignee"."taskId"));
CREATE POLICY parent_scoped_delete ON "TaskAssignee" FOR DELETE TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskAssignee"."taskId"));

CREATE POLICY parent_scoped_select ON "TaskLabel" FOR SELECT TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskLabel"."taskId"));
CREATE POLICY parent_scoped_insert ON "TaskLabel" FOR INSERT TO app_user, app_service
  WITH CHECK (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskLabel"."taskId")
              AND EXISTS (SELECT 1 FROM "Label" l WHERE l."id" = "TaskLabel"."labelId"));
CREATE POLICY parent_scoped_update ON "TaskLabel" FOR UPDATE TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskLabel"."taskId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskLabel"."taskId")
              AND EXISTS (SELECT 1 FROM "Label" l WHERE l."id" = "TaskLabel"."labelId"));
CREATE POLICY parent_scoped_delete ON "TaskLabel" FOR DELETE TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "Task" t WHERE t."id" = "TaskLabel"."taskId"));

CREATE POLICY parent_scoped_select ON "EventAttendee" FOR SELECT TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "Event" e WHERE e."id" = "EventAttendee"."eventId"));
CREATE POLICY parent_scoped_insert ON "EventAttendee" FOR INSERT TO app_user, app_service
  WITH CHECK (EXISTS (SELECT 1 FROM "Event" e WHERE e."id" = "EventAttendee"."eventId"));
CREATE POLICY parent_scoped_update ON "EventAttendee" FOR UPDATE TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "Event" e WHERE e."id" = "EventAttendee"."eventId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Event" e WHERE e."id" = "EventAttendee"."eventId"));
CREATE POLICY parent_scoped_delete ON "EventAttendee" FOR DELETE TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "Event" e WHERE e."id" = "EventAttendee"."eventId"));

CREATE POLICY parent_scoped_select ON "PollSlot" FOR SELECT TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollSlot"."pollId"));
CREATE POLICY parent_scoped_insert ON "PollSlot" FOR INSERT TO app_user, app_service
  WITH CHECK (EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollSlot"."pollId"));
CREATE POLICY parent_scoped_update ON "PollSlot" FOR UPDATE TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollSlot"."pollId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollSlot"."pollId"));
CREATE POLICY parent_scoped_delete ON "PollSlot" FOR DELETE TO app_user, app_service
  USING (EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollSlot"."pollId"));

-- PollResponse: the slot must belong to the poll. Members respond only as
-- themselves (guests go through the service path with the org GUC set).
CREATE POLICY app_user_select ON "PollResponse" FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollResponse"."pollId"));
CREATE POLICY app_user_insert ON "PollResponse" FOR INSERT TO app_user
  WITH CHECK ("userId" = (SELECT app.user_id())
              AND EXISTS (SELECT 1 FROM "PollSlot" s WHERE s."id" = "PollResponse"."slotId" AND s."pollId" = "PollResponse"."pollId"));
CREATE POLICY app_user_update ON "PollResponse" FOR UPDATE TO app_user
  USING ("userId" = (SELECT app.user_id())
         AND EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollResponse"."pollId"))
  WITH CHECK ("userId" = (SELECT app.user_id())
              AND EXISTS (SELECT 1 FROM "PollSlot" s WHERE s."id" = "PollResponse"."slotId" AND s."pollId" = "PollResponse"."pollId"));
CREATE POLICY app_user_delete ON "PollResponse" FOR DELETE TO app_user
  USING ("userId" = (SELECT app.user_id())
         AND EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollResponse"."pollId"));
CREATE POLICY app_service_select ON "PollResponse" FOR SELECT TO app_service
  USING (EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollResponse"."pollId"));
CREATE POLICY app_service_insert ON "PollResponse" FOR INSERT TO app_service
  WITH CHECK (EXISTS (SELECT 1 FROM "PollSlot" s WHERE s."id" = "PollResponse"."slotId" AND s."pollId" = "PollResponse"."pollId"));
CREATE POLICY app_service_update ON "PollResponse" FOR UPDATE TO app_service
  USING (EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollResponse"."pollId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "PollSlot" s WHERE s."id" = "PollResponse"."slotId" AND s."pollId" = "PollResponse"."pollId"));
CREATE POLICY app_service_delete ON "PollResponse" FOR DELETE TO app_service
  USING (EXISTS (SELECT 1 FROM "AvailabilityPoll" p WHERE p."id" = "PollResponse"."pollId"));

-- Receipt: same rule as canAccessTransaction (receipts-actions.ts:23-32).
CREATE POLICY app_user_select ON "Receipt" FOR SELECT TO app_user
  USING (EXISTS (SELECT 1 FROM "Transaction" t WHERE t."id" = "Receipt"."transactionId"
                 AND (t."submittedById" = (SELECT app.user_id()) OR (SELECT app.is_finance()))));
CREATE POLICY app_user_insert ON "Receipt" FOR INSERT TO app_user
  WITH CHECK ("uploadedById" = (SELECT app.user_id())
              AND EXISTS (SELECT 1 FROM "Transaction" t WHERE t."id" = "Receipt"."transactionId"
                          AND (t."submittedById" = (SELECT app.user_id()) OR (SELECT app.is_finance()))));
CREATE POLICY app_user_delete ON "Receipt" FOR DELETE TO app_user
  USING (EXISTS (SELECT 1 FROM "Transaction" t WHERE t."id" = "Receipt"."transactionId"
                 AND (t."submittedById" = (SELECT app.user_id()) OR (SELECT app.is_finance()))));
CREATE POLICY app_service_select ON "Receipt" FOR SELECT TO app_service
  USING (EXISTS (SELECT 1 FROM "Transaction" t WHERE t."id" = "Receipt"."transactionId"));
CREATE POLICY app_service_insert ON "Receipt" FOR INSERT TO app_service
  WITH CHECK (EXISTS (SELECT 1 FROM "Transaction" t WHERE t."id" = "Receipt"."transactionId"));
CREATE POLICY app_service_delete ON "Receipt" FOR DELETE TO app_service
  USING (EXISTS (SELECT 1 FROM "Transaction" t WHERE t."id" = "Receipt"."transactionId"));

-- ---- 6.14 New 0B tables ---------------------------------------------
-- Job: admins see their org's jobs (health view). Writes only through
-- app.enqueue_job / claim_jobs / finish_job / cancel_job.
CREATE POLICY app_user_select ON "Job" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "Job" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_user_select ON "OrgAuditLog" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "OrgAuditLog" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_user_select ON "OrgMemberHistory" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "OrgMemberHistory" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- RateLimitBucket and OrgSecret: RLS enabled, NO policies, NO grants.
-- Reached only through app.rate_limit_hit and app.secret_read/write/delete.

-- ---- 6.15 TEMPORARY strangler policies for app_legacy ----------------
-- Exactly the tables Phase 0-6 code touches today, minus the identity
-- tables it no longer needs (Auth.js moves to app_auth in 0B). Behaviour
-- equals today's app-only scoping. same_org_refs, member_of_parent_org
-- and immutable_cols still apply; the OWNER-rule and separation-of-duties
-- triggers do not (header). Each 0C module PR stops using app_legacy for
-- its tables; the last 0C PR drops these policies and the role.
CREATE POLICY app_legacy_all ON "User"             FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Organization"     FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Membership"       FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Invitation"       FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Notification"     FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Project"          FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Task"             FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Label"            FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Note"             FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Event"            FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "AvailabilityPoll" FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "BudgetPeriod"     FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "BudgetCategory"   FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Transaction"      FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Sponsor"          FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Sponsorship"      FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "FinanceAuditLog"  FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "TaskAssignee"     FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "TaskLabel"        FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "EventAttendee"    FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "PollSlot"         FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "PollResponse"     FOR ALL TO app_legacy USING (true) WITH CHECK (true);
CREATE POLICY app_legacy_all ON "Receipt"          FOR ALL TO app_legacy USING (true) WITH CHECK (true);


-- =====================================================================
-- Section 7. Grants. Explicit per table; no default table grants, so a
-- new table is unreachable until its migration grants it (fails loudly,
-- never silently open). No runtime role gets TRUNCATE, TRIGGER or
-- REFERENCES anywhere (app.security_manifest() asserts it).
-- =====================================================================
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_user, app_service, app_auth, app_legacy;
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON TABLE public._prisma_migrations FROM PUBLIC, app_user, app_service, app_auth, app_legacy';
  END IF;
END $$;

-- app_user
GRANT SELECT ON "User" TO app_user;
GRANT UPDATE ("name", "image", "timezone", "emailPreferences") ON "User" TO app_user; -- column grant (no table-level UPDATE)
GRANT SELECT, UPDATE ON "Organization" TO app_user;
GRANT SELECT, UPDATE, DELETE ON "Membership" TO app_user; -- no INSERT (D6)
GRANT SELECT, INSERT, UPDATE, DELETE ON "Invitation", "Project", "Task", "Label", "Note", "Event",
  "AvailabilityPoll", "BudgetPeriod", "BudgetCategory", "Sponsor", "Sponsorship",
  "TaskAssignee", "TaskLabel", "EventAttendee", "PollSlot", "PollResponse" TO app_user;
GRANT SELECT, INSERT ON "Notification" TO app_user;
GRANT UPDATE ("readAt") ON "Notification" TO app_user;
GRANT SELECT, INSERT, UPDATE ON "Transaction" TO app_user;
GRANT SELECT ON "FinanceAuditLog", "OrgAuditLog" TO app_user; -- writes via app.write_*_audit
GRANT SELECT, INSERT, DELETE ON "Receipt" TO app_user;
GRANT SELECT ON "Job", "OrgMemberHistory" TO app_user;

-- app_service
GRANT SELECT ON "User" TO app_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Organization", "Membership", "Invitation", "Project", "Task", "Label", "Note",
  "Event", "AvailabilityPoll", "BudgetPeriod", "BudgetCategory", "Sponsor", "Sponsorship",
  "TaskAssignee", "TaskLabel", "EventAttendee", "PollSlot", "PollResponse", "Notification" TO app_service;
GRANT SELECT, INSERT, UPDATE ON "Transaction" TO app_service;
GRANT SELECT ON "FinanceAuditLog", "OrgAuditLog" TO app_service; -- writes via app.write_*_audit
GRANT SELECT, INSERT, DELETE ON "Receipt" TO app_service;
GRANT SELECT ON "Job", "OrgMemberHistory" TO app_service;

-- app_auth: identity plane only
GRANT SELECT, INSERT, UPDATE, DELETE ON "User", "Account", "Session", "VerificationToken", "UserCredential" TO app_auth;

-- app_legacy: legacy tables only; FinanceAuditLog append-only at last
-- (this is what makes migration 20260913223951 effective).
GRANT SELECT, INSERT, UPDATE, DELETE ON "User", "Organization", "Membership", "Invitation", "Notification",
  "Project", "Task", "Label", "Note", "Event", "AvailabilityPoll", "BudgetPeriod", "BudgetCategory",
  "Transaction", "Sponsor", "Sponsorship", "TaskAssignee", "TaskLabel", "EventAttendee", "PollSlot",
  "PollResponse", "Receipt" TO app_legacy;
GRANT SELECT, INSERT ON "FinanceAuditLog" TO app_legacy;

-- Functions (explicit per role; nothing is executable by PUBLIC)
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ctx_valid(), app.user_id(), app.org_id(), app.utc_now()
  TO app_user, app_service, app_auth, app_legacy;
-- app_legacy needs set_context (and member_role, which it calls) for the
-- ICS credential functions; app_auth never sets a tenant context.
GRANT EXECUTE ON FUNCTION app.set_context(text, text), app.member_role()
  TO app_user, app_service, app_legacy;
GRANT EXECUTE ON FUNCTION app.member_org_id(), app.member_tier(), app.is_org_admin(), app.is_org_owner(),
  app.is_finance(), app.caller_org(), app.user_has_role(text, text, "Role"),
  app.org_has_members(text), app.org_has_other_owner(text, text), app.lock_org(text)
  TO app_user, app_service;
GRANT EXECUTE ON FUNCTION app.enqueue_job(text, text, text, jsonb, timestamp, integer, boolean)
  TO app_user, app_service, app_auth, app_legacy;
GRANT EXECUTE ON FUNCTION app.rate_limit_hit(text, integer, integer) TO app_service, app_auth;
GRANT EXECUTE ON FUNCTION app.claim_jobs(jsonb, integer), app.finish_job(text, text, text, text) TO app_service;
GRANT EXECUTE ON FUNCTION app.cancel_job(text, text) TO app_user, app_service;
GRANT EXECUTE ON FUNCTION app.secret_read(text, text, text),
  app.secret_write(text, text, text, bytea, bytea, bytea, bytea, bytea, bytea, integer),
  app.secret_delete(text, text, text) TO app_service;
GRANT EXECUTE ON FUNCTION app.invitation_by_token_hash(text), app.poll_org_id(text), app.active_org_ids() TO app_service;
GRANT EXECUTE ON FUNCTION app.pending_invitations_for_me(), app.slug_available(text) TO app_user;
GRANT EXECUTE ON FUNCTION app.set_ics_token_hash(text), app.ics_token_created_at() TO app_user, app_legacy;
GRANT EXECUTE ON FUNCTION app.write_org_audit(text, text, text, text, jsonb),
  app.write_finance_audit(text, text, text, text, jsonb) TO app_user, app_service;
GRANT EXECUTE ON FUNCTION app.purge_unverified_users(text) TO app_auth;


-- =====================================================================
-- Section 8. Backfill OrgMemberHistory: current members, plus every user
-- referenced by an org's rows (former members who authored data).
-- =====================================================================
INSERT INTO "OrgMemberHistory" ("organizationId", "userId", "firstJoinedAt", "lastJoinedAt", "leftAt")
SELECT m."organizationId", m."userId", m."joinedAt", m."joinedAt", NULL FROM "Membership" m
ON CONFLICT DO NOTHING;

INSERT INTO "OrgMemberHistory" ("organizationId", "userId", "firstJoinedAt", "lastJoinedAt", "leftAt")
SELECT DISTINCT r.org, r.uid, app.utc_now(), app.utc_now(), app.utc_now()
FROM (
  SELECT "organizationId" AS org, "createdById" AS uid FROM "Task"
  UNION SELECT t."organizationId", a."userId" FROM "TaskAssignee" a JOIN "Task" t ON t."id" = a."taskId"
  UNION SELECT "organizationId", "authorId" FROM "Note"
  UNION SELECT "organizationId", "updatedById" FROM "Note"
  UNION SELECT "organizationId", "createdById" FROM "Event"
  UNION SELECT e."organizationId", a."userId" FROM "EventAttendee" a JOIN "Event" e ON e."id" = a."eventId"
  UNION SELECT "organizationId", "createdById" FROM "AvailabilityPoll"
  UNION SELECT p."organizationId", r."userId" FROM "PollResponse" r JOIN "AvailabilityPoll" p ON p."id" = r."pollId" WHERE r."userId" IS NOT NULL
  UNION SELECT "organizationId", "submittedById" FROM "Transaction"
  UNION SELECT "organizationId", "approvedById" FROM "Transaction" WHERE "approvedById" IS NOT NULL
  UNION SELECT "organizationId", "reconciledById" FROM "Transaction" WHERE "reconciledById" IS NOT NULL
  UNION SELECT t."organizationId", rc."uploadedById" FROM "Receipt" rc JOIN "Transaction" t ON t."id" = rc."transactionId"
  UNION SELECT "organizationId", "ownerId" FROM "Sponsorship"
  UNION SELECT "organizationId", "actorId" FROM "FinanceAuditLog"
  UNION SELECT "organizationId", "invitedById" FROM "Invitation"
  UNION SELECT "organizationId", "userId" FROM "Notification"
) r
ON CONFLICT DO NOTHING;


-- =====================================================================
-- Section 9. Security manifest (the drift guard, attack N7)
-- Returns one row per violation; CI (T27) and /api/health (as
-- app_service) assert it returns none. SECURITY INVOKER: it reads only
-- world-readable catalogs. It covers every non-system schema, not just
-- public, and future migrations (a view, a partitioned table, a new
-- schema, a stray GRANT) are caught the first time CI runs.
--   rls_disabled            relkind r/p without RLS (_prisma_migrations
--                           excepted: it has no runtime grants)
--   view_not_invoker        a view a runtime role can read or write that
--                           lacks security_invoker=true (it would bypass RLS)
--   matview_or_foreign_granted  a materialized view or foreign table a
--                           runtime role can read (no RLS possible)
--   policy_gap              a granted (role, table, command) with no
--                           policy for that command
--   permissive_policy       USING/WITH CHECK (true) or FOR ALL for
--                           app_user/app_service; FOR ALL for anyone else
--                           but app_auth/app_legacy
--   dangerous_privilege     TRUNCATE (bypasses RLS and row triggers),
--                           TRIGGER or REFERENCES held by a runtime role
--   public_execute          a function in a non-system schema executable
--                           by PUBLIC (extension members excepted)
--   definer_search_path     a SECURITY DEFINER function whose search_path
--                           is not exactly pg_catalog, public, pg_temp
--   temp_privilege          a runtime role can create temp objects
--   schema_create           a runtime role can CREATE in some schema
--   role_attribute          a runtime role is superuser, BYPASSRLS,
--                           CREATEROLE, CREATEDB or REPLICATION
--   role_membership         a runtime role is a member of any role
--   owns_objects            a runtime role owns a relation, function,
--                           type or schema
-- =====================================================================
CREATE OR REPLACE FUNCTION app.security_manifest()
RETURNS TABLE (check_name text, object_name text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $$
  WITH rt AS (
    SELECT r.rolname, r.oid FROM pg_roles r
     WHERE r.rolname IN ('app_user', 'app_service', 'app_auth', 'app_legacy')
  ),
  nsp AS (
    SELECT n.oid, n.nspname FROM pg_namespace n
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND n.nspname !~ '^pg_(toast_)?temp_'
  ),
  ext AS (
    SELECT d.objid, d.classid FROM pg_depend d WHERE d.deptype = 'e'
  ),
  rel AS (
    SELECT c.oid, c.relkind, c.relrowsecurity, c.reloptions,
           format('%I.%I', n.nspname, c.relname) AS fq
      FROM pg_class c JOIN nsp n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND NOT (n.nspname = 'public' AND c.relname = '_prisma_migrations')
       AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_class'::regclass AND ext.objid = c.oid)
  ),
  readable AS (
    SELECT rel.oid, rt.rolname FROM rel, rt
     WHERE has_any_column_privilege(rt.oid, rel.oid, 'SELECT')
        OR has_any_column_privilege(rt.oid, rel.oid, 'INSERT')
        OR has_any_column_privilege(rt.oid, rel.oid, 'UPDATE')
        OR has_table_privilege(rt.oid, rel.oid, 'DELETE')
  ),
  cmd AS (SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS cmd),
  granted AS (
    SELECT rel.oid, rel.fq, rt.rolname, cmd.cmd FROM rel, rt, cmd
     WHERE rel.relkind IN ('r', 'p')
       AND CASE WHEN cmd.cmd = 'DELETE' THEN has_table_privilege(rt.oid, rel.oid, 'DELETE')
                ELSE has_any_column_privilege(rt.oid, rel.oid, cmd.cmd) END
  ),
  fn AS (
    SELECT p.oid, p.prosecdef, p.proconfig, p.proowner,
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS fq
      FROM pg_proc p JOIN nsp n ON n.oid = p.pronamespace
     WHERE NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_proc'::regclass AND ext.objid = p.oid)
  )
  SELECT 'rls_disabled', fq FROM rel WHERE relkind IN ('r', 'p') AND NOT relrowsecurity
  UNION ALL
  SELECT 'view_not_invoker', rel.fq FROM rel
   WHERE rel.relkind = 'v'
     AND EXISTS (SELECT 1 FROM readable WHERE readable.oid = rel.oid)
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(rel.reloptions, ARRAY[]::text[])) o
                      WHERE lower(o) IN ('security_invoker=true', 'security_invoker=on',
                                         'security_invoker=1', 'security_invoker=yes'))
  UNION ALL
  SELECT 'matview_or_foreign_granted', rel.fq FROM rel
   WHERE rel.relkind IN ('m', 'f') AND EXISTS (SELECT 1 FROM readable WHERE readable.oid = rel.oid)
  UNION ALL
  SELECT 'policy_gap', g.fq || ':' || g.rolname || ':' || g.cmd FROM granted g
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policy pol
      WHERE pol.polrelid = g.oid
        AND (pol.polroles = '{0}' OR (SELECT r.oid FROM pg_roles r WHERE r.rolname = g.rolname) = ANY (pol.polroles))
        AND (pol.polcmd = '*' OR pol.polcmd = CASE g.cmd WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a'
                                                         WHEN 'UPDATE' THEN 'w' ELSE 'd' END))
  UNION ALL
  SELECT 'permissive_policy', p.schemaname || '.' || p.tablename || ':' || p.policyname FROM pg_policies p
   WHERE p.schemaname IN (SELECT nspname FROM nsp)
     AND (((p.roles && ARRAY['app_user', 'app_service']::name[])
           AND (p.qual = 'true' OR p.with_check = 'true' OR p.cmd = 'ALL'))
       OR (p.cmd = 'ALL' AND NOT (p.roles <@ ARRAY['app_auth', 'app_legacy']::name[])))
  UNION ALL
  SELECT 'dangerous_privilege', rel.fq || ':' || rt.rolname || ':' || pr.priv
    FROM rel, rt, (VALUES ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) pr(priv)
   WHERE CASE pr.priv WHEN 'REFERENCES' THEN has_any_column_privilege(rt.oid, rel.oid, 'REFERENCES')
                      ELSE has_table_privilege(rt.oid, rel.oid, pr.priv) END
  UNION ALL
  SELECT 'public_execute', fn.fq FROM fn WHERE has_function_privilege('public', fn.oid, 'EXECUTE')
  UNION ALL
  SELECT 'definer_search_path', fn.fq FROM fn
   WHERE fn.prosecdef
     AND NOT coalesce(fn.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'], false)
  UNION ALL
  SELECT 'temp_privilege', rt.rolname::text FROM rt
   WHERE has_database_privilege(rt.oid, current_database(), 'TEMPORARY')
  UNION ALL
  SELECT 'schema_create', nsp.nspname || ':' || rt.rolname FROM nsp, rt
   WHERE has_schema_privilege(rt.oid, nsp.oid, 'CREATE')
  UNION ALL
  SELECT 'role_attribute', r.rolname::text FROM pg_roles r JOIN rt ON rt.oid = r.oid
   WHERE r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
  UNION ALL
  SELECT 'role_membership', rt.rolname || ' in ' || g.rolname FROM pg_auth_members m
    JOIN rt ON rt.oid = m.member JOIN pg_roles g ON g.oid = m.roleid
  UNION ALL
  SELECT 'owns_objects', rt.rolname::text FROM rt
   WHERE EXISTS (SELECT 1 FROM pg_class c WHERE c.relowner = rt.oid)
      OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.proowner = rt.oid)
      OR EXISTS (SELECT 1 FROM pg_type t WHERE t.typowner = rt.oid)
      OR EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspowner = rt.oid)
$$;
REVOKE EXECUTE ON FUNCTION app.security_manifest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.security_manifest() TO app_service;
