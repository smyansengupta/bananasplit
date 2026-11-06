-- Home's new widgets, and Announcements in the Inbox.
--
--   1. Announcement: a post to the whole organization, shown at the top of
--      the Inbox. Any member posts; the author or an owner/admin edits or
--      removes it (deletedAt, deletedById); only whoever removed it, or an
--      owner/admin, puts it back. AnnouncementSeen counts who has seen each one
--      ("Seen by N of M"): every member reads the rows, each writes only
--      their own.
--   2. Decision: something the organization has to decide, with an owner
--      and an outcome (Home's Decisions). Any member raises one and takes an
--      unowned one; the owner, whoever raised it or an owner/admin decides
--      or drops it. A settled one doesn't change again.
--   3. ItemLink gains three kinds: an announcement links to its event, a
--      decision to the meetings, notes, polls and events it came from, and
--      "poll" is a question poll.
--   4. MemberPrefs remembers the last two Home visits ("Since you were
--      here"); MemberPresence remembers which page each member has open
--      ("Here now").
--   5. Indexes for Home's reads: activity, comments and mentions by org and
--      time, tasks by creator, decisions by owner and raiser.

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('OPEN', 'DECIDED', 'DROPPED');

-- AlterTable
ALTER TABLE "MemberPrefs" ADD COLUMN "homePrevVisitAt" TIMESTAMP(3),
ADD COLUMN "homeVisitAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "MemberPresence" ADD COLUMN "pageHref" TEXT,
ADD COLUMN "pageLabel" TEXT;

-- CreateTable
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "authorId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementSeen" (
    "organizationId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementSeen_pkey" PRIMARY KEY ("announcementId","userId")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "detail" TEXT,
    "status" "DecisionStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "ownerId" TEXT,
    "createdById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Announcement_organizationId_deletedAt_createdAt_idx" ON "Announcement"("organizationId", "deletedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Announcement_organizationId_id_key" ON "Announcement"("organizationId", "id");

-- CreateIndex
CREATE INDEX "AnnouncementSeen_organizationId_userId_idx" ON "AnnouncementSeen"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Decision_organizationId_status_createdAt_idx" ON "Decision"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Decision_ownerId_idx" ON "Decision"("ownerId");

-- CreateIndex
CREATE INDEX "Decision_createdById_idx" ON "Decision"("createdById");

-- CreateIndex
CREATE INDEX "TaskActivity_organizationId_type_createdAt_idx" ON "TaskActivity"("organizationId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "TaskComment_organizationId_createdAt_idx" ON "TaskComment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "NoteComment_organizationId_createdAt_idx" ON "NoteComment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskMention_organizationId_mentionedById_createdAt_idx" ON "TaskMention"("organizationId", "mentionedById", "createdAt");

-- CreateIndex
CREATE INDEX "Task_organizationId_createdById_status_idx" ON "Task"("organizationId", "createdById", "status");

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementSeen" ADD CONSTRAINT "AnnouncementSeen_organizationId_announcementId_fkey" FOREIGN KEY ("organizationId", "announcementId") REFERENCES "Announcement"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementSeen" ADD CONSTRAINT "AnnouncementSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written: data, checks, triggers, RLS, grants and the manifest.
-- ---------------------------------------------------------------------------

-- The user asked for everyone's Home to start over on the new default view
-- (src/lib/overview/widgets.ts): saved layouts were built from the old
-- widgets, so they all go back to the default and anyone can customize
-- again from there.
UPDATE "MemberPrefs" SET "overviewWidgets" = NULL;

ALTER TABLE "ItemLink" DROP CONSTRAINT "ItemLink_kinds_known";
ALTER TABLE "ItemLink" ADD CONSTRAINT "ItemLink_kinds_known"
  CHECK ("fromKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget', 'record', 'poll', 'decision', 'announcement')
     AND "toKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget', 'record', 'poll', 'decision', 'announcement'));

ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_lengths"
  CHECK (char_length("title") BETWEEN 1 AND 200 AND char_length("body") <= 10000);
-- Who removed a post is set only while it's removed.
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_deleted_by_when_deleted"
  CHECK ("deletedById" IS NULL OR "deletedAt" IS NOT NULL);
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_lengths"
  CHECK (char_length("question") BETWEEN 1 AND 200
     AND ("detail" IS NULL OR char_length("detail") <= 2000)
     AND ("outcome" IS NULL OR char_length("outcome") <= 500));
-- A decided decision says what was decided, and when.
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_outcome_when_decided"
  CHECK ("status" <> 'DECIDED' OR ("outcome" IS NOT NULL AND "decidedAt" IS NOT NULL));
ALTER TABLE "MemberPresence" ADD CONSTRAINT "MemberPresence_page_lengths"
  CHECK (("pageHref" IS NULL OR char_length("pageHref") <= 300)
     AND ("pageLabel" IS NULL OR char_length("pageLabel") <= 80));

-- Whoever owns a decision is a member of its organization.
CREATE TRIGGER org_member_refs BEFORE INSERT OR UPDATE ON "Decision"
  FOR EACH ROW EXECUTE FUNCTION app.assert_org_member('ownerId');

-- ---- Announcement ---------------------------------------------------------
-- app_user: a new post is live. Removing one records who removed it
-- (deletedById is the actor) and putting it back clears that; deletedById
-- moves only with deletedAt. A removed post is whoever removed it to put
-- back, or an owner/admin: an author can't undo an admin's removal, or edit
-- the post while it's down. The service path is not limited.
CREATE OR REPLACE FUNCTION app.announcement_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."deletedAt" IS NOT NULL OR NEW."deletedById" IS NOT NULL THEN
      RAISE EXCEPTION 'Announcement: a new post is live' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."deletedAt" IS NOT NULL
     AND OLD."deletedById" IS DISTINCT FROM app.user_id()
     AND NOT app.is_org_admin() THEN
    RAISE EXCEPTION 'Announcement: only whoever removed it, or an admin, puts it back' USING ERRCODE = '42501';
  END IF;
  IF (OLD."deletedAt" IS NULL) <> (NEW."deletedAt" IS NULL) THEN
    IF NEW."deletedAt" IS NULL AND NEW."deletedById" IS NOT NULL THEN
      RAISE EXCEPTION 'Announcement: putting a post back clears who removed it' USING ERRCODE = '42501';
    END IF;
    IF NEW."deletedAt" IS NOT NULL AND NEW."deletedById" IS DISTINCT FROM app.user_id() THEN
      RAISE EXCEPTION 'Announcement: remove a post as yourself' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW."deletedById" IS DISTINCT FROM OLD."deletedById" THEN
    RAISE EXCEPTION 'Announcement: deletedById moves only with deletedAt' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.announcement_guard() FROM PUBLIC;
CREATE TRIGGER announcement_guard BEFORE INSERT OR UPDATE ON "Announcement"
  FOR EACH ROW EXECUTE FUNCTION app.announcement_guard();

ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "Announcement" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Announcement" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "authorId" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "Announcement" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("authorId" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("authorId" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_service_select ON "Announcement" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Announcement" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "Announcement" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT ON "Announcement" TO app_user;
GRANT UPDATE ("title", "body", "updatedAt", "deletedAt", "deletedById") ON "Announcement" TO app_user;
GRANT SELECT, DELETE ON "Announcement" TO app_service;

-- ---- AnnouncementSeen -----------------------------------------------------
-- Seeing is an insert (ON CONFLICT DO NOTHING); nobody updates or deletes.
ALTER TABLE "AnnouncementSeen" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "AnnouncementSeen" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "AnnouncementSeen" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_service_select ON "AnnouncementSeen" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "AnnouncementSeen" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "AnnouncementSeen" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT ON "AnnouncementSeen" TO app_user;
GRANT SELECT, DELETE ON "AnnouncementSeen" TO app_service;

-- ---- Decision -------------------------------------------------------------
-- Any member reaches an unowned decision (taking it is setting ownerId to
-- yourself); an owned one only its owner, whoever raised it, or an
-- owner/admin. Only status, outcome, ownerId, decidedAt and updatedAt are
-- UPDATE columns (nothing edits the question), and app.decision_guard
-- narrows the rest: nothing changes once it's settled, and short of an
-- owner/admin, ownerId moves only from nobody to you (taking it) or from
-- you to nobody (a departing owner lets go), and only its owner or whoever
-- raised it settles one. Nothing is deleted: a decision is decided or
-- dropped.
CREATE OR REPLACE FUNCTION app.decision_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_me text;
BEGIN
  IF current_user <> 'app_user' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'OPEN' THEN
    RAISE EXCEPTION 'Decision: a settled decision doesn''t change' USING ERRCODE = '42501';
  END IF;
  IF app.is_org_admin() THEN
    RETURN NEW;
  END IF;
  v_me := app.user_id();
  IF NEW."ownerId" IS DISTINCT FROM OLD."ownerId"
     AND NOT ((OLD."ownerId" IS NULL AND NEW."ownerId" = v_me)
              OR (OLD."ownerId" = v_me AND NEW."ownerId" IS NULL)) THEN
    RAISE EXCEPTION 'Decision: take it yourself, or let it go' USING ERRCODE = '42501';
  END IF;
  IF (NEW."status" IS DISTINCT FROM OLD."status"
      OR NEW."outcome" IS DISTINCT FROM OLD."outcome"
      OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt")
     AND OLD."ownerId" IS DISTINCT FROM v_me
     AND OLD."createdById" IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'Decision: only its owner, whoever raised it, or an admin settles it' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.decision_guard() FROM PUBLIC;
CREATE TRIGGER decision_guard BEFORE UPDATE ON "Decision"
  FOR EACH ROW EXECUTE FUNCTION app.decision_guard();

ALTER TABLE "Decision" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "Decision" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "Decision" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "Decision" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("ownerId" IS NULL OR "ownerId" = (SELECT app.user_id())
              OR "createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("ownerId" IS NULL OR "ownerId" = (SELECT app.user_id())
                   OR "createdById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_service_select ON "Decision" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Decision" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "Decision" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT ON "Decision" TO app_user;
GRANT UPDATE ("status", "outcome", "ownerId", "decidedAt", "updatedAt") ON "Decision" TO app_user;
GRANT SELECT, DELETE ON "Decision" TO app_service;

-- ---- MemberPresence -------------------------------------------------------
-- The page you have open moves with each beat, like lastSeenAt.
GRANT UPDATE ("pageHref", "pageLabel") ON "MemberPresence" TO app_user;

-- ---- app.security_manifest ------------------------------------------
-- The tenant-only-write allowlist gains Announcement:INSERT,
-- AnnouncementSeen:INSERT and Decision:INSERT (unchanged otherwise from
-- 20261101180000_member_presence). If another migration after this one
-- redefines the manifest, it must keep these entries.
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
       'Decision:INSERT'
     ])
$$;
