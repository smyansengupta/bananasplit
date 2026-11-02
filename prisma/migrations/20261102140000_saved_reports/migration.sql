-- Saved reports (Databases > Reports): a report is one source (a database,
-- or Tasks, Expenses, Events or People) and a board of widgets on it, built
-- by the New report walkthrough; a snapshot is a report as it read at one
-- moment (Past reports).
--
--   Report: any member makes one (createdById pinned). PRIVATE ones are
--   seen by whoever made it, ORGANIZATION ones by every member; either way
--   the numbers each viewer sees come from the rows THEY can see, so a
--   shared report never shares a row. Whoever made it edits and archives
--   it; an owner/admin also does on a shared one. Nothing is deleted.
--   ReportSnapshot: whoever can see the report takes one (takenById
--   pinned); never edited, never deleted by a member.

-- CreateEnum
CREATE TYPE "ReportAccess" AS ENUM ('PRIVATE', 'ORGANIZATION');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "access" "ReportAccess" NOT NULL DEFAULT 'ORGANIZATION',
    "widgets" JSONB NOT NULL DEFAULT '[]',
    "insights" JSONB,
    "insightsAt" TIMESTAMP(3),
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "takenById" TEXT,
    "rangeLabel" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_organizationId_archivedAt_updatedAt_idx" ON "Report"("organizationId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Report_createdById_idx" ON "Report"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Report_organizationId_id_key" ON "Report"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ReportSnapshot_organizationId_reportId_takenAt_idx" ON "ReportSnapshot"("organizationId", "reportId", "takenAt");

-- CreateIndex
CREATE INDEX "ReportSnapshot_takenById_idx" ON "ReportSnapshot"("takenById");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_organizationId_reportId_fkey" FOREIGN KEY ("organizationId", "reportId") REFERENCES "Report"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: RLS, grants and the manifest.
-- ---------------------------------------------------------------------------

-- ---- Report ---------------------------------------------------------------
ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "Report" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("access" = 'ORGANIZATION' OR "createdById" = (SELECT app.user_id())));
CREATE POLICY app_user_insert ON "Report" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "Report" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("createdById" = (SELECT app.user_id())
              OR ("access" = 'ORGANIZATION' AND (SELECT app.is_org_admin()))))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("createdById" = (SELECT app.user_id())
                   OR ("access" = 'ORGANIZATION' AND (SELECT app.is_org_admin()))));
CREATE POLICY app_service_select ON "Report" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Report" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "Report" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT ON "Report" TO app_user;
GRANT UPDATE ("title", "access", "widgets", "insights", "insightsAt", "archivedAt", "updatedAt") ON "Report" TO app_user;
GRANT SELECT, DELETE ON "Report" TO app_service;

-- ---- ReportSnapshot -------------------------------------------------------
-- The report's own SELECT policy applies inside the EXISTS, so a snapshot is
-- seen (and taken) exactly where its report is.
ALTER TABLE "ReportSnapshot" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "ReportSnapshot" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND EXISTS (SELECT 1 FROM "Report" r
                      WHERE r."organizationId" = "ReportSnapshot"."organizationId"
                        AND r."id" = "ReportSnapshot"."reportId"));
CREATE POLICY app_user_insert ON "ReportSnapshot" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND "takenById" = (SELECT app.user_id())
              AND EXISTS (SELECT 1 FROM "Report" r
                           WHERE r."organizationId" = "ReportSnapshot"."organizationId"
                             AND r."id" = "ReportSnapshot"."reportId"
                             AND r."archivedAt" IS NULL));
CREATE POLICY app_service_select ON "ReportSnapshot" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "ReportSnapshot" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "ReportSnapshot" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT ON "ReportSnapshot" TO app_user;
GRANT SELECT, DELETE ON "ReportSnapshot" TO app_service;

-- ---- app.security_manifest ------------------------------------------
-- The tenant-only-write allowlist gains Report:INSERT and
-- ReportSnapshot:INSERT (unchanged otherwise from 20261102100000_home_widgets).
-- If another migration after this one redefines the manifest, it must keep
-- these entries.
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
       -- A project's lead is cleared by the member who leaves the org
       -- (untieDepartingMember runs as them), and members keep a project's
       -- status, dates and lead current, so the UPDATE cannot be
       -- admin-only. Deleting projects is; creating them is too unless the
       -- org lets members (OrgSettings.memberCanCreateProjects).
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
       'MemberPrefs:INSERT', 'MemberPrefs:UPDATE', 'OrgFile:INSERT',
       'NoteFolder:INSERT',
       -- Question polls: any member asks one (createdById pinned) and votes
       -- as themselves while it is open (userId pinned, and the option must
       -- belong to the same poll). Closing, reopening and deleting a poll,
       -- and removing an option, are creator-or-admin.
       'Poll:INSERT', 'PollVote:INSERT', 'PollVote:DELETE',
       -- Club-made databases: a member adds and edits rows only where
       -- app.can_edit_database lets them (owners and admins, or members of a
       -- database that allows it), a role check the manifest can't read in
       -- the policy text. INSERT pins createdById; deleting for good is
       -- admin-only.
       'DatabaseRecord:INSERT', 'DatabaseRecord:UPDATE',
       -- Note sharing: a note's author (or an owner/admin, on a club note)
       -- shares it, which app.can_share_note decides, a role check the
       -- manifest can't read in the policy text. INSERT pins createdById
       -- and requires the person to be a member; anyone may also take
       -- themselves off a note shared with them (DELETE).
       'NoteShare:INSERT', 'NoteShare:UPDATE', 'NoteShare:DELETE',
       -- Note comments: whoever can see the note comments as themselves
       -- (app.can_view_note, authorId pinned); the author edits the body and
       -- whoever may edit the note resolves (app.can_edit_note, with
       -- app.note_comment_guard deciding the columns); the author or
       -- whoever may share the note deletes (app.can_share_note). Role
       -- checks the manifest can't read in the policy text.
       'NoteComment:INSERT', 'NoteComment:UPDATE', 'NoteComment:DELETE',
       -- Note versions: whoever may edit the note saves one as themselves
       -- and renames one (name is app_user's only UPDATE column); whoever
       -- may share the note deletes. app.can_edit_note and
       -- app.can_share_note are the role checks.
       'NoteVersion:INSERT', 'NoteVersion:UPDATE', 'NoteVersion:DELETE',
       -- The org chart: every member edits it (orgchart.write is every
       -- role). A new version pins createdById to the actor; a position is
       -- deleted only from a DRAFT. History is never deleted (no version
       -- DELETE), and the org's pointer moves only through
       -- app.set_active_org_chart.
       'OrgChartVersion:INSERT', 'OrgChartVersion:UPDATE',
       'OrgChartPosition:INSERT', 'OrgChartPosition:UPDATE', 'OrgChartPosition:DELETE',
       -- Each member hides and un-hides cards on their own Overview;
       -- the policies pin userId to the actor, which is a stronger test
       -- than a role check, not a weaker one.
       'UpNextDismissal:INSERT', 'UpNextDismissal:DELETE',
       -- AI connectors: a user's own grants (userId pinned on every
       -- command, no org involved). The connector path records and renews
       -- its grant as the user; Disconnect revokes it.
       'ConnectorGrant:INSERT', 'ConnectorGrant:UPDATE', 'ConnectorGrant:DELETE',
       -- Links between things in a space: any member links two things they
       -- can see (createdById pinned on INSERT; the app checks both ends
       -- resolve for them) and any member removes a link. A link carries
       -- no titles, so it reveals nothing the viewer can't already open.
       'ItemLink:INSERT', 'ItemLink:DELETE',
       -- The Inbox: each member snoozes and finishes their own items
       -- (userId pinned to the actor on every command, a stronger test
       -- than a role check).
       'InboxItemState:INSERT', 'InboxItemState:UPDATE', 'InboxItemState:DELETE',
       -- Who's online: each member marks only themselves as here (userId
       -- pinned to the actor on INSERT and UPDATE); nobody deletes.
       'MemberPresence:INSERT', 'MemberPresence:UPDATE',
       -- Announcements: any member posts one (authorId pinned to the actor);
       -- editing and removing are author-or-admin.
       'Announcement:INSERT',
       -- Each member marks only their own sightings (userId pinned).
       'AnnouncementSeen:INSERT',
       -- Decisions: any member raises one (createdById pinned); taking,
       -- deciding and dropping are owner, raiser or admin
       -- (app.decision_guard).
       'Decision:INSERT',
       -- Saved reports: any member makes one (createdById pinned); editing
       -- and archiving are maker-or-admin. Snapshots are taken as yourself
       -- (takenById pinned) of a report you can see.
       'Report:INSERT', 'ReportSnapshot:INSERT'
     ])
$$;
