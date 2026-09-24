-- C4: task visibility — an open board with private opt-in.
--
-- Every member sees every task in the org (visibility = 'ORG', the default).
-- A task marked 'PRIVATE' is readable only by:
--
--   * its owner        ("ownerId")
--   * its collaborators ("TaskAssignee")
--   * its creator      ("createdById")
--   * org OWNER/ADMIN
--
-- The database enforces that, not the application: the app_user SELECT
-- policy on "Task" carries the predicate, and so do the policies on
-- everything that hangs off a task — comments, mentions, activity,
-- collaborators, labels and the notifications that point at it. An app-layer
-- `where` that forgot the rule therefore returns nothing rather than a leak.
--
-- The same predicate also guards the app_user UPDATE and DELETE *USING*
-- clauses, so a member cannot blind-write a private task by guessing its id.
-- The WITH CHECK clauses stay tenant-only on purpose: the row an edit
-- produces need not still be visible to its editor (an owner handing a
-- private task to somebody else would otherwise lock itself out mid-
-- statement). Who may *change* the flag is the application's rule — the
-- owner, the creator or an OWNER/ADMIN — enforced in src/server/tasks.
--
-- app_service is unchanged and still sees the whole org: jobs, digests and
-- reminders run there and filter in code (src/server/tasks/visibility.ts).

-- CreateEnum
CREATE TYPE "TaskVisibility" AS ENUM ('ORG', 'PRIVATE');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "visibility" "TaskVisibility" NOT NULL DEFAULT 'ORG';

-- CreateIndex
CREATE INDEX "Task_organizationId_visibility_idx" ON "Task"("organizationId", "visibility");

-- ---------------------------------------------------------------------------
-- The one readable-task predicate
-- ---------------------------------------------------------------------------

-- Is the current app_user allowed to read p_task?
--
-- SECURITY DEFINER for the same reason app.member_role() is: it reads "Task"
-- and "TaskAssignee" without RLS, so the policies that call it cannot recurse
-- into themselves (a policy on "TaskAssignee" that had to read "TaskAssignee"
-- would). It answers only about the caller's own identity — every branch is
-- pinned to app.user_id() — so it cannot be used to read another person's
-- access. Rows outside the caller's member org are never readable.
CREATE OR REPLACE FUNCTION app.can_read_task(p_task text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."Task" t
     WHERE t."id" = p_task
       AND t."organizationId" = app.member_org_id()
       AND (t."visibility" = 'ORG'
            OR t."ownerId" = app.user_id()
            OR t."createdById" = app.user_id()
            OR app.is_org_admin()
            OR EXISTS (SELECT 1 FROM public."TaskAssignee" ta
                        WHERE ta."taskId" = t."id"
                          AND ta."userId" = app.user_id()))
  )
$$;
REVOKE ALL ON FUNCTION app.can_read_task(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.can_read_task(text) TO app_user, app_service;

COMMENT ON FUNCTION app.can_read_task(text) IS
  'C4: may the current app_user SELECT this task? ORG tasks: yes. PRIVATE: owner, collaborator, creator or OWNER/ADMIN only.';

-- ---------------------------------------------------------------------------
-- Subtasks inherit their parent's visibility
-- ---------------------------------------------------------------------------

-- Both directions, so the two can never diverge:
--   BEFORE INSERT/UPDATE on a subtask  -> take the parent's visibility;
--   AFTER UPDATE of a parent's flag    -> push it down to the children.
-- The AFTER half recurses through the BEFORE half for any deeper nesting and
-- terminates on the `IS DISTINCT FROM` guard. SECURITY INVOKER: the cascade
-- runs under the caller's own UPDATE policy, which is org-scoped, so it
-- needs no extra privilege.
CREATE OR REPLACE FUNCTION app.task_visibility_inherit() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_parent "TaskVisibility";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_WHEN = 'BEFORE' THEN
    IF NEW."parentTaskId" IS NOT NULL THEN
      SELECT t."visibility" INTO v_parent
        FROM public."Task" t WHERE t."id" = NEW."parentTaskId";
      IF FOUND AND NEW."visibility" IS DISTINCT FROM v_parent THEN
        NEW."visibility" := v_parent;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- AFTER UPDATE: the flag moved, so the children follow.
  UPDATE public."Task"
     SET "visibility" = NEW."visibility"
   WHERE "parentTaskId" = NEW."id"
     AND "visibility" IS DISTINCT FROM NEW."visibility";
  RETURN NULL;
END;
$$;

CREATE TRIGGER task_visibility_inherit_biu
  BEFORE INSERT OR UPDATE OF "visibility", "parentTaskId" ON "Task"
  FOR EACH ROW EXECUTE FUNCTION app.task_visibility_inherit();

CREATE TRIGGER task_visibility_cascade_au
  AFTER UPDATE OF "visibility" ON "Task"
  FOR EACH ROW WHEN (OLD."visibility" IS DISTINCT FROM NEW."visibility")
  EXECUTE FUNCTION app.task_visibility_inherit();

-- ---------------------------------------------------------------------------
-- Task: SELECT, UPDATE and DELETE now test visibility
-- ---------------------------------------------------------------------------

-- The cheap disjunct is spelled out in the policy so an ORG task — nearly
-- every row — never calls the function at all.
DROP POLICY IF EXISTS app_user_select ON "Task";
CREATE POLICY app_user_select ON "Task" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("visibility" = 'ORG'
              OR "ownerId" = (SELECT app.user_id())
              OR "createdById" = (SELECT app.user_id())
              OR (SELECT app.is_org_admin())
              OR app.can_read_task("id")));

DROP POLICY IF EXISTS app_user_update ON "Task";
CREATE POLICY app_user_update ON "Task" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("visibility" = 'ORG'
              OR "ownerId" = (SELECT app.user_id())
              OR "createdById" = (SELECT app.user_id())
              OR (SELECT app.is_org_admin())
              OR app.can_read_task("id")))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));

DROP POLICY IF EXISTS app_user_delete ON "Task";
CREATE POLICY app_user_delete ON "Task" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("visibility" = 'ORG'
              OR "ownerId" = (SELECT app.user_id())
              OR "createdById" = (SELECT app.user_id())
              OR (SELECT app.is_org_admin())
              OR app.can_read_task("id")));

-- ---------------------------------------------------------------------------
-- Everything that hangs off a task is hidden with it
-- ---------------------------------------------------------------------------

-- Reads follow the task. Writes INTO a task follow it too, so nobody can
-- drop a comment, a mention or a collaborator into a private thread by
-- guessing its id. UPDATE and DELETE on these children keep the posture the
-- b9 backstop reviewed (tenant-scoped, author- or admin-gated where it
-- matters): a private task is never weaker than an open one, and tightening
-- them further would only lock an author out of a comment they can no
-- longer see.
DROP POLICY IF EXISTS app_user_select ON "TaskComment";
CREATE POLICY app_user_select ON "TaskComment" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND app.can_read_task("taskId"));
DROP POLICY IF EXISTS app_user_insert ON "TaskComment";
CREATE POLICY app_user_insert ON "TaskComment" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND "authorId" = (SELECT app.user_id())
              AND app.can_read_task("taskId"));

DROP POLICY IF EXISTS app_user_select ON "TaskMention";
CREATE POLICY app_user_select ON "TaskMention" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND app.can_read_task("taskId"));
DROP POLICY IF EXISTS app_user_insert ON "TaskMention";
CREATE POLICY app_user_insert ON "TaskMention" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("mentionedById" IS NULL OR "mentionedById" = (SELECT app.user_id()))
              AND app.can_read_task("taskId"));

DROP POLICY IF EXISTS app_user_select ON "TaskActivity";
CREATE POLICY app_user_select ON "TaskActivity" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND app.can_read_task("taskId"));
DROP POLICY IF EXISTS app_user_insert ON "TaskActivity";
CREATE POLICY app_user_insert ON "TaskActivity" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("actorId" IS NULL OR "actorId" = (SELECT app.user_id()))
              AND app.can_read_task("taskId"));

DROP POLICY IF EXISTS app_user_select ON "TaskAssignee";
CREATE POLICY app_user_select ON "TaskAssignee" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND app.can_read_task("taskId"));
DROP POLICY IF EXISTS app_user_insert ON "TaskAssignee";
CREATE POLICY app_user_insert ON "TaskAssignee" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND app.can_read_task("taskId"));

DROP POLICY IF EXISTS app_user_select ON "TaskLabel";
CREATE POLICY app_user_select ON "TaskLabel" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND app.can_read_task("taskId"));
DROP POLICY IF EXISTS app_user_insert ON "TaskLabel";
CREATE POLICY app_user_insert ON "TaskLabel" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND app.can_read_task("taskId"));

-- A notification carries its task's title. Once the task is out of reach —
-- because it was made private, or because the recipient was taken off it —
-- the notification goes with it, in the bell and in the digest that reads
-- these rows back.
DROP POLICY IF EXISTS app_user_select ON "Notification";
CREATE POLICY app_user_select ON "Notification" FOR SELECT TO app_user
  USING ("userId" = (SELECT app.user_id())
         AND ("taskId" IS NULL OR app.can_read_task("taskId")));
