-- CreateTable
CREATE TABLE "Pin" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "targetId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentVisit" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecentVisit_pkey" PRIMARY KEY ("userId","organizationId","href")
);

-- CreateTable
CREATE TABLE "MemberPrefs" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financeWidgets" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberPrefs_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateTable
CREATE TABLE "OrgFile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'ORGANIZATION',
    "uploadedById" TEXT NOT NULL,
    "noteId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pin_organizationId_userId_sortOrder_idx" ON "Pin"("organizationId", "userId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Pin_userId_organizationId_href_key" ON "Pin"("userId", "organizationId", "href");

-- CreateIndex
CREATE INDEX "RecentVisit_userId_organizationId_visitedAt_idx" ON "RecentVisit"("userId", "organizationId", "visitedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrgFile_storageKey_key" ON "OrgFile"("storageKey");

-- CreateIndex
CREATE INDEX "OrgFile_organizationId_deletedAt_createdAt_idx" ON "OrgFile"("organizationId", "deletedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentVisit" ADD CONSTRAINT "RecentVisit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecentVisit" ADD CONSTRAINT "RecentVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPrefs" ADD CONSTRAINT "MemberPrefs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPrefs" ADD CONSTRAINT "MemberPrefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgFile" ADD CONSTRAINT "OrgFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgFile" ADD CONSTRAINT "OrgFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: checks, RLS and grants (docs/ARCHITECTURE.md, "RLS").
-- ---------------------------------------------------------------------------

ALTER TABLE "Pin" ADD CONSTRAINT "Pin_href_scope"
  CHECK ("href" ~ '^/app/[a-z0-9-]+(/[^\s]*)?$' AND char_length("href") <= 400);
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_label_length" CHECK (char_length("label") BETWEEN 1 AND 120);
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_kind_known"
  CHECK ("kind" IN ('page', 'note', 'task', 'event', 'database', 'person', 'file'));

ALTER TABLE "RecentVisit" ADD CONSTRAINT "RecentVisit_href_scope"
  CHECK ("href" ~ '^/app/[a-z0-9-]+(/[^\s]*)?$' AND char_length("href") <= 400);
ALTER TABLE "RecentVisit" ADD CONSTRAINT "RecentVisit_label_length" CHECK (char_length("label") BETWEEN 1 AND 120);
ALTER TABLE "RecentVisit" ADD CONSTRAINT "RecentVisit_kind_known"
  CHECK ("kind" IN ('page', 'note', 'task', 'event', 'database', 'person', 'file'));

ALTER TABLE "OrgFile" ADD CONSTRAINT "OrgFile_name_length" CHECK (char_length("name") BETWEEN 1 AND 200);
ALTER TABLE "OrgFile" ADD CONSTRAINT "OrgFile_size_positive" CHECK ("sizeBytes" > 0);

-- Pin, RecentVisit, MemberPrefs: the member's own rows in their current org.
ALTER TABLE "Pin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecentVisit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MemberPrefs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "Pin" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_insert ON "Pin" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "Pin" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_delete ON "Pin" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));

CREATE POLICY app_user_select ON "RecentVisit" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_insert ON "RecentVisit" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "RecentVisit" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_delete ON "RecentVisit" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));

CREATE POLICY app_user_select ON "MemberPrefs" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_insert ON "MemberPrefs" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "MemberPrefs" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));

REVOKE ALL ON "Pin", "RecentVisit", "MemberPrefs" FROM PUBLIC, app_user, app_service, app_auth, app_legacy;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Pin" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "RecentVisit" TO app_user;
GRANT SELECT, INSERT, UPDATE ON "MemberPrefs" TO app_user;

-- OrgFile: every member reads the org's shared files, the uploader also their
-- private ones; members upload as themselves; the uploader or an admin
-- renames, re-shares or deletes (soft: deletedAt). The service role reads
-- them for the org export and purge, only with an org context.
ALTER TABLE "OrgFile" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "OrgFile" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("visibility" = 'ORGANIZATION' OR "uploadedById" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "OrgFile" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "uploadedById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "OrgFile" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("uploadedById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "OrgFile" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "OrgFile" FROM PUBLIC, app_user, app_service, app_auth, app_legacy;
GRANT SELECT, INSERT, UPDATE ON "OrgFile" TO app_user;
GRANT SELECT ON "OrgFile" TO app_service;

-- The security manifest's tenant-only-write allowlist gains the own-row
-- policies above: they test organizationId AND userId (or uploadedById), so
-- they are member writes by design (the function body is otherwise unchanged
-- from 20260930120000_private_availability).
CREATE OR REPLACE FUNCTION app.security_manifest()
RETURNS TABLE (check_name text, object_name text)
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp SET jit = off
AS $$
  WITH RECURSIVE rt AS (
    SELECT r.rolname, r.oid FROM pg_roles r
     WHERE r.rolname IN ('app_user', 'app_service', 'app_auth')
  ),
  nsp AS (
    SELECT n.oid, n.nspname FROM pg_namespace n
     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
       AND n.nspname !~ '^pg_(toast_)?temp_'
  ),
  -- Schemas a runtime role can look names up in.
  reach_nsp AS (
    SELECT nsp.oid FROM nsp
     WHERE EXISTS (SELECT 1 FROM rt WHERE has_schema_privilege(rt.oid, nsp.oid, 'USAGE'))
  ),
  -- Every object a runtime role can get to, by name or through a reachable
  -- object (see the migration header).
  reached (classid, objid) AS (
    SELECT 'pg_class'::regclass::oid, c.oid FROM pg_class c
     WHERE c.relnamespace IN (SELECT oid FROM reach_nsp)
    UNION
    SELECT 'pg_proc'::regclass::oid, p.oid FROM pg_proc p
     WHERE p.pronamespace IN (SELECT oid FROM reach_nsp)
    UNION
    SELECT 'pg_type'::regclass::oid, t.oid FROM pg_type t
     WHERE t.typnamespace IN (SELECT oid FROM reach_nsp)
    UNION
    SELECT 'pg_operator'::regclass::oid, o.oid FROM pg_operator o
     WHERE o.oprnamespace IN (SELECT oid FROM reach_nsp)
    UNION
    SELECT 'pg_cast'::regclass::oid, k.oid FROM pg_cast k
    UNION
    SELECT x.classid, x.objid
      FROM reached r
     CROSS JOIN LATERAL (
       -- what it depends on
       SELECT d.refclassid, d.refobjid FROM pg_depend d
        WHERE d.classid = r.classid AND d.objid = r.objid
          AND d.refclassid <> 'pg_namespace'::regclass
       UNION ALL
       -- its parts
       SELECT d.classid, d.objid FROM pg_depend d
        WHERE d.refclassid = r.classid AND d.refobjid = r.objid
          AND d.deptype IN ('a', 'i')
     ) x (classid, objid)
  ),
  ext AS (
    SELECT d.objid, d.classid FROM pg_depend d WHERE d.deptype = 'e'
  ),
  -- Every relation, for the checks that stay global.
  rel_all AS (
    SELECT c.oid, c.relkind, c.relrowsecurity, c.reloptions,
           format('%I.%I', n.nspname, c.relname) AS fq
      FROM pg_class c JOIN nsp n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
       AND NOT (n.nspname = 'public' AND c.relname = '_prisma_migrations')
       AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_class'::regclass AND ext.objid = c.oid)
  ),
  -- The reachable ones, for the object checks.
  rel AS (
    SELECT rel_all.* FROM rel_all
     WHERE EXISTS (SELECT 1 FROM reached
                    WHERE reached.classid = 'pg_class'::regclass AND reached.objid = rel_all.oid)
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
  fn_all AS (
    SELECT p.oid, p.prosecdef, p.proconfig, p.proowner,
           format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS fq,
           EXISTS (SELECT 1 FROM reached
                    WHERE reached.classid = 'pg_proc'::regclass AND reached.objid = p.oid) AS reachable,
           EXISTS (SELECT 1 FROM pg_event_trigger e WHERE e.evtfoid = p.oid) AS fires_on_ddl
      FROM pg_proc p JOIN nsp n ON n.oid = p.pronamespace
     WHERE NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_proc'::regclass AND ext.objid = p.oid)
  ),
  fn AS (
    SELECT * FROM fn_all WHERE fn_all.reachable
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
     AND EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   JOIN reached ON reached.classid = 'pg_class'::regclass AND reached.objid = c.oid
                  WHERE n.nspname = p.schemaname AND c.relname = p.tablename)
     AND (((p.roles && ARRAY['app_user', 'app_service']::name[])
           AND (p.qual = 'true' OR p.with_check = 'true' OR p.cmd = 'ALL'))
       OR (p.cmd = 'ALL' AND NOT (p.roles <@ ARRAY['app_auth']::name[])))
  UNION ALL
  SELECT 'dangerous_privilege', rel_all.fq || ':' || rt.rolname || ':' || pr.priv
    FROM rel_all, rt, (VALUES ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) pr(priv)
   WHERE CASE pr.priv WHEN 'REFERENCES' THEN has_any_column_privilege(rt.oid, rel_all.oid, 'REFERENCES')
                      ELSE has_table_privilege(rt.oid, rel_all.oid, pr.priv) END
  UNION ALL
  SELECT 'public_execute', fn.fq FROM fn WHERE has_function_privilege('public', fn.oid, 'EXECUTE')
  UNION ALL
  SELECT 'definer_search_path', fn_all.fq FROM fn_all
   WHERE (fn_all.reachable OR fn_all.fires_on_ddl)
     AND fn_all.prosecdef
     AND NOT coalesce(fn_all.proconfig @> ARRAY['search_path=pg_catalog, public, pg_temp'], false)
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

  UNION ALL
  -- Tenant-only writes (B9, unchanged). A policy that lets app_user INSERT,
  -- UPDATE or DELETE with nothing but an organizationId test is a tenant
  -- check, not a permission check: every member of the org may do it, and
  -- the app layer is the only thing standing in the way. That is right for
  -- the tables below, where members legitimately write; anywhere else it is
  -- a missing role predicate, and this reports it until the table is
  -- reviewed and added here in a migration. Label shipped without one:
  -- label management has always been admin-only in the app, and any member
  -- could delete every label in the org straight through the database.
  SELECT 'tenant_only_write', p.tablename || ':' || p.cmd FROM pg_policies p
   WHERE p.schemaname = 'public'
     AND p.roles && ARRAY['app_user']::name[]
     AND p.cmd IN ('INSERT', 'UPDATE', 'DELETE')
     AND coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%is_org_admin%'
     AND coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%is_org_owner%'
     AND coalesce(p.qual, '') || coalesce(p.with_check, '') NOT LIKE '%is_finance%'
     AND (p.tablename || ':' || p.cmd) <> ALL (ARRAY[
       -- Tasks are the shared work surface: any member files, edits and
       -- closes one (the edit-authorization matrix is the app's, and the
       -- self-assign carve-out depends on it). INSERT pins createdById.
       'Task:INSERT', 'Task:UPDATE', 'Task:DELETE',
       -- Collaborators and labels on a task move with the task itself.
       'TaskAssignee:INSERT', 'TaskAssignee:UPDATE', 'TaskAssignee:DELETE',
       'TaskLabel:INSERT', 'TaskLabel:UPDATE', 'TaskLabel:DELETE',
       -- Mentions are a side effect of writing a description or a comment;
       -- INSERT pins mentionedById to the actor.
       'TaskMention:INSERT', 'TaskMention:UPDATE', 'TaskMention:DELETE',
       -- Append-only, actor pinned; there is no UPDATE or DELETE policy.
       'TaskActivity:INSERT',
       -- Author pinned on INSERT; UPDATE and DELETE are author-or-admin.
       'TaskComment:INSERT', 'Note:INSERT',
       -- Each member writes their own Sunday update (userId pinned); DELETE
       -- is admin-gated.
       'WeeklyUpdate:INSERT', 'WeeklyUpdate:UPDATE',
       -- A project's triage owner is cleared by the member who leaves the
       -- org (untieDepartingMember runs as them), so the UPDATE cannot be
       -- admin-only. Creating and deleting projects is.
       'Project:UPDATE',
       -- Anyone may open an availability poll (createdById pinned) and it
       -- carries its own slots; answering is pinned to the responder.
       'AvailabilityPoll:INSERT', 'AvailabilityPoll:UPDATE', 'AvailabilityPoll:DELETE',
       'PollSlot:INSERT', 'PollSlot:UPDATE', 'PollSlot:DELETE',
       'PollResponse:INSERT', 'PollResponse:UPDATE', 'PollResponse:DELETE',
       -- Creating an event invites other members, so attendee rows are
       -- written for people other than the actor.
       'EventAttendee:INSERT', 'EventAttendee:UPDATE', 'EventAttendee:DELETE',
       -- A notification is addressed to another member (the WITH CHECK
       -- requires the recipient to be one); marking one read is own-row.
       'Notification:INSERT', 'Notification:UPDATE',
       -- Own row, and a column-level grant that excludes email.
       'User:UPDATE',
       -- Own row only: a user's availability (onboarding). Nobody else reads
       -- or writes it; co-members see busy hours through
       -- app.member_busy_hours, which checks the org and its setting.
       'UserAvailability:INSERT', 'UserAvailability:UPDATE',
       'Pin:INSERT', 'Pin:UPDATE', 'Pin:DELETE',
       'RecentVisit:INSERT', 'RecentVisit:UPDATE', 'RecentVisit:DELETE',
       'MemberPrefs:INSERT', 'MemberPrefs:UPDATE', 'OrgFile:INSERT'
     ])
$$;
