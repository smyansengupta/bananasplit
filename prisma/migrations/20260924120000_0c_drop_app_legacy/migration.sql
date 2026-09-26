-- 0C: drop app_legacy, the strangler role.
--
-- 0B gave app_legacy `FOR ALL USING (true) WITH CHECK (true)` on 23 tables
-- so the unmigrated Phase 0-6 modules could keep working while each moved to
-- withOrgAction/appDb. For that role, row-level security was effectively off:
-- it read and wrote every org's rows, and the membership, organization and
-- separation-of-duties triggers did not bind it.
--
-- Every module has moved. Nothing in the application reaches app_legacy any
-- more (@/lib/prisma, legacyDb and the ESLint allowlist are gone in the same
-- change), so the window closes here: the 23 policies go, the grants go, the
-- role's branches inside the definer functions go, and the role is dropped.
--
-- Roles are cluster-global while a migration is per-database, and Postgres
-- checks only the current database before dropping one: DROP ROLE succeeds
-- while another database still has grants naming it, leaving dangling ACL
-- entries there and breaking whatever connects as it. So the drop at the end
-- runs only when this is the sole application database in the cluster (a
-- Neon project, a CI database). Anywhere else — a shared local cluster
-- running several checkouts — it raises a notice instead, and the operator
-- drops the role once every database has run this migration (RUNBOOK, 'Runtime
-- roles'). Either way this database is left with nothing granted to app_legacy,
-- which is what the security manifest and the RLS suite assert.

-- ---- 1. The strangler policies ---------------------------------------
DROP POLICY IF EXISTS app_legacy_all ON "User";
DROP POLICY IF EXISTS app_legacy_all ON "Organization";
DROP POLICY IF EXISTS app_legacy_all ON "Membership";
DROP POLICY IF EXISTS app_legacy_all ON "Invitation";
DROP POLICY IF EXISTS app_legacy_all ON "Notification";
DROP POLICY IF EXISTS app_legacy_all ON "Project";
DROP POLICY IF EXISTS app_legacy_all ON "Task";
DROP POLICY IF EXISTS app_legacy_all ON "Label";
DROP POLICY IF EXISTS app_legacy_all ON "Note";
DROP POLICY IF EXISTS app_legacy_all ON "Event";
DROP POLICY IF EXISTS app_legacy_all ON "AvailabilityPoll";
DROP POLICY IF EXISTS app_legacy_all ON "BudgetPeriod";
DROP POLICY IF EXISTS app_legacy_all ON "BudgetCategory";
DROP POLICY IF EXISTS app_legacy_all ON "Transaction";
DROP POLICY IF EXISTS app_legacy_all ON "Sponsor";
DROP POLICY IF EXISTS app_legacy_all ON "Sponsorship";
DROP POLICY IF EXISTS app_legacy_all ON "FinanceAuditLog";
DROP POLICY IF EXISTS app_legacy_all ON "TaskAssignee";
DROP POLICY IF EXISTS app_legacy_all ON "TaskLabel";
DROP POLICY IF EXISTS app_legacy_all ON "EventAttendee";
DROP POLICY IF EXISTS app_legacy_all ON "PollSlot";
DROP POLICY IF EXISTS app_legacy_all ON "PollResponse";
DROP POLICY IF EXISTS app_legacy_all ON "Receipt";

-- ---- 2. The definer functions that branched on the role ---------------
-- enqueue_job loses the branch that let app_legacy queue notify-email,
-- invite-email and reimbursement-email for any row of the org it named.
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

-- The ICS feed token: app_user only (the calendar settings moved off the
-- legacy path in b2_ics_feed_off).
CREATE OR REPLACE FUNCTION app.set_ics_token_hash(p_hash text) RETURNS timestamp(3)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_user text := app.user_id();
  v_at timestamp(3) := app.utc_now();
BEGIN
  IF v_user IS NULL OR session_user <> 'app_user' THEN
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

CREATE OR REPLACE FUNCTION app.ics_token_created_at() RETURNS timestamp(3)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT c."icsTokenCreatedAt" FROM public."UserCredential" c
   WHERE c."userId" = app.user_id() AND c."icsTokenHash" IS NOT NULL
     AND session_user = 'app_user'
$$;

-- Authorship immutability binds the runtime roles; there is one fewer now.
CREATE OR REPLACE FUNCTION app.immutable_columns() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  k text;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF current_user NOT IN ('app_user', 'app_service') THEN
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

-- The catalog manifest no longer inspects the role, and no longer exempts
-- a FOR ALL policy that names it. app_auth keeps its exemption (the
-- identity tables).
CREATE OR REPLACE FUNCTION app.security_manifest()
RETURNS TABLE (check_name text, object_name text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $$
  WITH rt AS (
    SELECT r.rolname, r.oid FROM pg_roles r
     WHERE r.rolname IN ('app_user', 'app_service', 'app_auth')
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
       OR (p.cmd = 'ALL' AND NOT (p.roles <@ ARRAY['app_auth']::name[])))
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

-- ---- 3. Grants, then the role ----------------------------------------
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_legacy') THEN
    RAISE NOTICE 'app_legacy does not exist; nothing to revoke';
    RETURN;
  END IF;
  EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_legacy';
  EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_legacy';
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM app_legacy';
  EXECUTE 'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM app_legacy';
  EXECUTE 'REVOKE ALL ON SCHEMA public FROM app_legacy';
  EXECUTE 'REVOKE ALL ON SCHEMA app FROM app_legacy';
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM app_legacy', current_database());
END $do$;

-- DROP OWNED BY clears anything granted in THIS database that the loop
-- above missed (default privileges, column grants). It is its own block so
-- that a DROP ROLE which cannot proceed does not roll it back.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_legacy') THEN RETURN; END IF;
  EXECUTE 'DROP OWNED BY app_legacy';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'cannot DROP OWNED BY app_legacy: %', SQLERRM;
END $do$;

DO $do$
DECLARE
  v_others integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_legacy') THEN RETURN; END IF;
  SELECT count(*) INTO v_others FROM pg_database
   WHERE NOT datistemplate AND datname <> current_database() AND datname <> 'postgres';
  IF v_others > 0 THEN
    RAISE NOTICE 'app_legacy holds nothing in %, but % other database(s) share this cluster: '
                 'drop the role by hand once every one of them has run this migration',
                 current_database(), v_others;
    RETURN;
  END IF;
  EXECUTE 'DROP ROLE app_legacy';
  RAISE NOTICE 'dropped role app_legacy';
EXCEPTION WHEN insufficient_privilege OR dependent_objects_still_exist THEN
  RAISE NOTICE 'left role app_legacy in place: %', SQLERRM;
END $do$;
