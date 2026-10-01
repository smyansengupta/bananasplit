-- Question polls ("ask anything"): a question, options members vote on,
-- and settings (multiple choice, anonymous, members add options, results
-- hidden until it closes, a closing time). Members only; the availability
-- polls (AvailabilityPoll, PollSlot, PollResponse) are unchanged.
-- See docs/features/calendar.md, "Question polls".

-- CreateTable
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "multiple" BOOLEAN NOT NULL DEFAULT false,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "allowMemberOptions" BOOLEAN NOT NULL DEFAULT false,
    "hideResultsUntilClosed" BOOLEAN NOT NULL DEFAULT false,
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollOption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollVote" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Poll_organizationId_createdAt_idx" ON "Poll"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Poll_organizationId_id_key" ON "Poll"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PollOption_pollId_idx" ON "PollOption"("pollId");

-- CreateIndex
CREATE UNIQUE INDEX "PollOption_organizationId_id_key" ON "PollOption"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PollVote_pollId_idx" ON "PollVote"("pollId");

-- CreateIndex
CREATE INDEX "PollVote_organizationId_pollId_idx" ON "PollVote"("organizationId", "pollId");

-- CreateIndex
CREATE UNIQUE INDEX "PollVote_optionId_userId_key" ON "PollVote"("optionId", "userId");

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_organizationId_pollId_fkey" FOREIGN KEY ("organizationId", "pollId") REFERENCES "Poll"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_organizationId_pollId_fkey" FOREIGN KEY ("organizationId", "pollId") REFERENCES "Poll"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_organizationId_optionId_fkey" FOREIGN KEY ("organizationId", "optionId") REFERENCES "PollOption"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------------------------------------------------------------------------
-- Hand-written: checks, RLS, grants and the vote counts.
-- ---------------------------------------------------------------------------

ALTER TABLE "Poll" ADD CONSTRAINT "Poll_question_length"
  CHECK (char_length(btrim("question")) >= 1 AND char_length("question") <= 200);
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_description_length"
  CHECK ("description" IS NULL OR char_length("description") <= 2000);
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_label_length"
  CHECK (char_length(btrim("label")) >= 1 AND char_length("label") <= 120);

-- Poll: every member reads the org's polls and asks one as themselves; the
-- creator or an owner/admin closes, reopens or deletes it. UPDATE is a
-- column grant (closedAt, closesAt): the question, the options and the
-- settings never change after creation, so an anonymous poll stays one.
ALTER TABLE "Poll" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "Poll" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Poll" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "Poll" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "Poll" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_service_select ON "Poll" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- PollOption: the creator and owners/admins add options, and members too
-- when the poll allows it, always as themselves; the creator or an
-- owner/admin removes one (its votes go with it). No UPDATE.
ALTER TABLE "PollOption" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "PollOption" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "PollOption" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND "addedById" = (SELECT app.user_id())
              AND EXISTS (SELECT 1 FROM "Poll" p
                           WHERE p."id" = "PollOption"."pollId"
                             AND (p."createdById" = (SELECT app.user_id())
                                  OR p."allowMemberOptions"
                                  OR (SELECT app.is_org_admin()))));
CREATE POLICY app_user_delete ON "PollOption" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND (EXISTS (SELECT 1 FROM "Poll" p
                       WHERE p."id" = "PollOption"."pollId" AND p."createdById" = (SELECT app.user_id()))
              OR (SELECT app.is_org_admin())));
CREATE POLICY app_service_select ON "PollOption" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- PollVote. Anonymity lives here: on an anonymous poll a member reads only
-- their own votes, whoever they are (the creator and owners included);
-- app.poll_vote_counts() below gives everyone the counts. A vote is cast as
-- yourself, for an option of the same poll (the composite FKs only keep
-- both in the org), while the poll is open; withdrawing one is your own,
-- also only while it is open, so a closed poll's result stays put.
-- Changing a vote is delete + insert: no UPDATE.
ALTER TABLE "PollVote" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "PollVote" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("userId" = (SELECT app.user_id())
              OR EXISTS (SELECT 1 FROM "Poll" p WHERE p."id" = "PollVote"."pollId" AND NOT p."anonymous")));
CREATE POLICY app_user_insert ON "PollVote" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND "userId" = (SELECT app.user_id())
              AND EXISTS (SELECT 1 FROM "PollOption" o
                           WHERE o."id" = "PollVote"."optionId" AND o."pollId" = "PollVote"."pollId")
              AND EXISTS (SELECT 1 FROM "Poll" p
                           WHERE p."id" = "PollVote"."pollId"
                             AND p."closedAt" IS NULL
                             AND (p."closesAt" IS NULL OR p."closesAt" > (SELECT app.utc_now()))));
CREATE POLICY app_user_delete ON "PollVote" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND "userId" = (SELECT app.user_id())
         AND EXISTS (SELECT 1 FROM "Poll" p
                      WHERE p."id" = "PollVote"."pollId"
                        AND p."closedAt" IS NULL
                        AND (p."closesAt" IS NULL OR p."closesAt" > (SELECT app.utc_now()))));
CREATE POLICY app_service_select ON "PollVote" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "Poll", "PollOption", "PollVote" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, DELETE ON "Poll" TO app_user;
GRANT UPDATE ("closedAt", "closesAt", "updatedAt") ON "Poll" TO app_user;
GRANT SELECT, INSERT, DELETE ON "PollOption" TO app_user;
GRANT SELECT, INSERT, DELETE ON "PollVote" TO app_user;
-- The org export (registry.ts drops PollVote.userId, so an anonymous poll
-- stays anonymous there too).
GRANT SELECT ON "Poll", "PollOption", "PollVote" TO app_service;

-- The results of question polls: one row per option of each poll in
-- p_polls, with its votes and the poll's distinct voters. Counts only, never
-- who: this is how members see the results of an anonymous poll, whose
-- other votes RLS hides from them. Answers only for polls of the caller's
-- member org (app.member_org_id()); anything else is left out.
CREATE OR REPLACE FUNCTION app.poll_vote_counts(p_polls text[])
RETURNS TABLE ("pollId" text, "optionId" text, "votes" bigint, "voters" bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH polls AS (
    SELECT p."id" FROM public."Poll" p
     WHERE p."id" = ANY (p_polls)
       AND p."organizationId" = (SELECT app.member_org_id())
  ),
  per_option AS (
    SELECT v."optionId", count(*) AS n FROM public."PollVote" v
     WHERE v."pollId" IN (SELECT polls."id" FROM polls)
     GROUP BY v."optionId"
  ),
  per_poll AS (
    SELECT v."pollId", count(DISTINCT v."userId") AS n FROM public."PollVote" v
     WHERE v."pollId" IN (SELECT polls."id" FROM polls)
     GROUP BY v."pollId"
  )
  SELECT o."pollId", o."id", coalesce(po.n, 0), coalesce(pp.n, 0)
    FROM public."PollOption" o
    JOIN polls ON polls."id" = o."pollId"
    LEFT JOIN per_option po ON po."optionId" = o."id"
    LEFT JOIN per_poll pp ON pp."pollId" = o."pollId"
$$;

REVOKE ALL ON FUNCTION app.poll_vote_counts(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.poll_vote_counts(text[]) TO app_user;

-- The manifest's tenant-only-write allowlist gains Poll:INSERT,
-- PollVote:INSERT and PollVote:DELETE (unchanged otherwise from
-- 20261002120000_folders_sidebar_boards).
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
       'MemberPrefs:INSERT', 'MemberPrefs:UPDATE', 'OrgFile:INSERT',
       'NoteFolder:INSERT',
       -- Question polls: any member asks one (createdById pinned) and votes
       -- as themselves while it is open (userId pinned, and the option must
       -- belong to the same poll). Closing, reopening and deleting a poll,
       -- and removing an option, are creator-or-admin.
       'Poll:INSERT', 'PollVote:INSERT', 'PollVote:DELETE'
     ])
$$;
