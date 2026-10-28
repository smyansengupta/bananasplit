-- Meetings (docs/features/meetings.md). The RSVPs section becomes Meetings:
-- one place to set up anything that happens at a time, in three shapes - an
-- online meeting, an in-person one, or an event with a public sign-up page.
-- Bananasplit can now MAKE the online meeting through the org's connected
-- Google Meet, Zoom or Teams account, where before it only labelled a link
-- someone had pasted.
--
-- Three pieces here:
--   1. Event learns its format, and the provider meeting we made for it,
--      mirroring the existing google* columns: a managed flag, the
--      provider's own id, the join details, and the same sync state machine
--      with its compare-and-set on syncVersion.
--   2. EventReminderSend replaces the two reminder columns on
--      EventRegistration with one row per reminder actually sent, so a
--      meeting can set any offsets it likes and can remind MEMBERS too, not
--      only public sign-ups. The unique key is the idempotency guard.
--   3. UpNextDismissal lets a member hide one stale card from their
--      Overview's "Up next".
--
-- Each meeting provider is its own IntegrationProvider row, so an org can
-- have Meet without mirroring its whole calendar, or Zoom with no Google
-- account at all. The refresh tokens go in OrgSecret as REFRESH_TOKEN,
-- exactly as Google Calendar's does.

-- CreateEnum
CREATE TYPE "MeetingFormat" AS ENUM ('ONLINE', 'IN_PERSON', 'HYBRID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "IntegrationProvider" ADD VALUE 'GOOGLE_MEET';
ALTER TYPE "IntegrationProvider" ADD VALUE 'ZOOM';
ALTER TYPE "IntegrationProvider" ADD VALUE 'MICROSOFT_TEAMS';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "conferenceDialIn" JSONB,
ADD COLUMN     "conferenceHostUrl" TEXT,
ADD COLUMN     "conferenceManaged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "conferenceMeetingId" TEXT,
ADD COLUMN     "conferenceManagedAt" "ConferenceProvider",
ADD COLUMN     "conferencePasscode" TEXT,
ADD COLUMN     "conferenceSyncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "conferenceSyncError" TEXT,
ADD COLUMN     "conferenceSyncState" "CalendarSyncState" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "conferenceSyncedAt" TIMESTAMP(3),
ADD COLUMN     "format" "MeetingFormat" NOT NULL DEFAULT 'IN_PERSON',
ADD COLUMN     "reminderMinutes" INTEGER[] DEFAULT ARRAY[1440, 60]::INTEGER[];

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "meetingReminderMinutes" INTEGER[] DEFAULT ARRAY[1440, 60]::INTEGER[];

-- CreateTable
CREATE TABLE "EventReminderSend" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "offsetMinutes" INTEGER NOT NULL,
    "userId" TEXT,
    "registrationId" TEXT,
    "recipientKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReminderSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpNextDismissal" (
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpNextDismissal_pkey" PRIMARY KEY ("userId","organizationId","kind","refId")
);

-- CreateIndex
CREATE INDEX "EventReminderSend_organizationId_eventId_idx" ON "EventReminderSend"("organizationId", "eventId");

-- CreateIndex
CREATE INDEX "EventReminderSend_userId_idx" ON "EventReminderSend"("userId");

-- CreateIndex
CREATE INDEX "EventReminderSend_registrationId_idx" ON "EventReminderSend"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "EventReminderSend_eventId_offsetMinutes_channel_recipientKe_key" ON "EventReminderSend"("eventId", "offsetMinutes", "channel", "recipientKey");

-- CreateIndex
CREATE INDEX "UpNextDismissal_organizationId_userId_idx" ON "UpNextDismissal"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Event_conferenceSyncState_idx" ON "Event"("conferenceSyncState");

-- AddForeignKey
ALTER TABLE "EventReminderSend" ADD CONSTRAINT "EventReminderSend_organizationId_eventId_fkey" FOREIGN KEY ("organizationId", "eventId") REFERENCES "Event"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReminderSend" ADD CONSTRAINT "EventReminderSend_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventReminderSend" ADD CONSTRAINT "EventReminderSend_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "EventRegistration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpNextDismissal" ADD CONSTRAINT "UpNextDismissal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpNextDismissal" ADD CONSTRAINT "UpNextDismissal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: the format backfill, checks, RLS, grants and the manifest.
-- ---------------------------------------------------------------------------

-- An event that already had a conference link is an online meeting; one with
-- a link AND a place was already hybrid in everything but name.
UPDATE "Event" SET "format" = CASE
    WHEN "conferenceProvider" <> 'NONE' AND coalesce(btrim("location"), '') <> '' THEN 'HYBRID'::"MeetingFormat"
    WHEN "conferenceProvider" <> 'NONE' THEN 'ONLINE'::"MeetingFormat"
    ELSE 'IN_PERSON'::"MeetingFormat"
  END;

-- A meeting we did not create is one we must never move or cancel, so a
-- managed meeting has to carry the provider's id for it.
ALTER TABLE "Event" ADD CONSTRAINT "Event_conferenceManaged_needs_id"
  CHECK (NOT "conferenceManaged" OR "conferenceMeetingId" IS NOT NULL);
-- A managed meeting has to say where it lives, so it can still be cancelled
-- after someone turns the call off or switches provider. Deliberately NOT a
-- check against conferenceProvider: that column is what is WANTED now, and
-- the two differ for exactly as long as the teardown takes.
ALTER TABLE "Event" ADD CONSTRAINT "Event_conferenceManaged_needs_where"
  CHECK (NOT "conferenceManaged" OR ("conferenceManagedAt" IS NOT NULL AND "conferenceManagedAt" <> 'NONE'));
ALTER TABLE "Event" ADD CONSTRAINT "Event_conferenceMeetingId_length"
  CHECK ("conferenceMeetingId" IS NULL OR char_length("conferenceMeetingId") <= 255);
ALTER TABLE "Event" ADD CONSTRAINT "Event_conferencePasscode_length"
  CHECK ("conferencePasscode" IS NULL OR char_length("conferencePasscode") <= 64);
ALTER TABLE "Event" ADD CONSTRAINT "Event_conferenceHostUrl_scheme"
  CHECK ("conferenceHostUrl" IS NULL OR "conferenceHostUrl" ~ '^https://');
-- Reminder offsets: at most eight, each between a minute and four weeks out,
-- and no duplicates (the send guard is per offset, so a repeated offset would
-- be a reminder silently dropped rather than one sent twice). A CHECK cannot
-- hold a subquery and an array test needs unnest, so it goes in an IMMUTABLE
-- function; both the event's own offsets and the org's default use it.
CREATE OR REPLACE FUNCTION app.reminder_offsets_ok(p integer[])
RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp
AS $$
  SELECT p IS NULL
      OR (
        coalesce(array_length(p, 1), 0) <= 8
        AND NOT EXISTS (SELECT 1 FROM unnest(p) m WHERE m < 1 OR m > 40320)
        AND coalesce(array_length(p, 1), 0) = (SELECT count(DISTINCT m) FROM unnest(p) m)
      )
$$;
REVOKE ALL ON FUNCTION app.reminder_offsets_ok(integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reminder_offsets_ok(integer[]) TO app_user, app_service;

ALTER TABLE "Event" ADD CONSTRAINT "Event_reminderMinutes_sane"
  CHECK (app.reminder_offsets_ok("reminderMinutes"));
ALTER TABLE "OrgSettings" ADD CONSTRAINT "OrgSettings_meetingReminderMinutes_sane"
  CHECK (app.reminder_offsets_ok("meetingReminderMinutes"));

-- Exactly one recipient per send: a member, or a public sign-up.
ALTER TABLE "EventReminderSend" ADD CONSTRAINT "EventReminderSend_one_recipient"
  CHECK (("userId" IS NULL) <> ("registrationId" IS NULL));
ALTER TABLE "EventReminderSend" ADD CONSTRAINT "EventReminderSend_channel_known"
  CHECK ("channel" IN ('email', 'sms', 'app'));
ALTER TABLE "EventReminderSend" ADD CONSTRAINT "EventReminderSend_offsetMinutes_range"
  CHECK ("offsetMinutes" >= 1 AND "offsetMinutes" <= 40320);

-- recipientKey is the recipient as one non-null value, so the unique index
-- above really is a guard: under the default NULLS DISTINCT, an index over
-- the two nullable columns would have treated every row with a null userId as
-- distinct from itself, and a retried job could have sent the same reminder
-- twice. The check keeps the key honest.
ALTER TABLE "EventReminderSend" ADD CONSTRAINT "EventReminderSend_recipientKey_matches"
  CHECK ("recipientKey" = CASE WHEN "userId" IS NOT NULL THEN 'u:' || "userId" ELSE 'g:' || "registrationId" END);

ALTER TABLE "UpNextDismissal" ADD CONSTRAINT "UpNextDismissal_kind_known"
  CHECK ("kind" IN ('task', 'meeting', 'event', 'rsvp', 'poll'));
ALTER TABLE "UpNextDismissal" ADD CONSTRAINT "UpNextDismissal_refId_length"
  CHECK (char_length("refId") BETWEEN 1 AND 64);

-- EventReminderSend says who was emailed or texted about an event and when.
-- Guests' identities live behind EventRegistration, which is admin-only in
-- the suite, so this follows it: owners and admins read it, and only the
-- jobs (the service path) write it.
ALTER TABLE "EventReminderSend" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "EventReminderSend" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "EventReminderSend" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "EventReminderSend" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "EventReminderSend" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "EventReminderSend" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT ON "EventReminderSend" TO app_user;
GRANT SELECT, INSERT, DELETE ON "EventReminderSend" TO app_service;

-- UpNextDismissal is each member's own: what they hid from their own
-- Overview. Nobody else reads it, not even an admin, and there is no UPDATE
-- (hiding is insert, un-hiding is delete).
ALTER TABLE "UpNextDismissal" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "UpNextDismissal" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_insert ON "UpNextDismissal" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_delete ON "UpNextDismissal" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_service_select ON "UpNextDismissal" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "UpNextDismissal" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "UpNextDismissal" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, DELETE ON "UpNextDismissal" TO app_user;
GRANT SELECT, DELETE ON "UpNextDismissal" TO app_service;

-- ---- app.security_manifest ------------------------------------------
-- The tenant-only-write allowlist gains UpNextDismissal:INSERT/DELETE
-- (unchanged otherwise from 20261019150000_org_chart_member_edits).
-- EventReminderSend needs no entry: app_user may only read it.
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
       'UpNextDismissal:INSERT', 'UpNextDismissal:DELETE'
     ])
$$;
