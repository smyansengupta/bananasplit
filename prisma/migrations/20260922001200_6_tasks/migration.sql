-- =====================================================================
-- Phase 6: Tasks + email
-- =====================================================================
-- The owner model (Task.ownerId, BLOCKED), TaskAssignee/TaskLabel
-- denormalized with organizationId and composite FKs, comments, mentions,
-- activity, Sunday updates, intake projects and notification fields.
-- TaskStatus BLOCKED and the new NotificationType values shipped in
-- 20260922001100_6_enum_values.

-- CreateEnum
CREATE TYPE "AssignmentRelation" AS ENUM ('SELF', 'DOWN_LINE', 'PEER', 'ABOVE', 'OUTSIDE_CHART');

-- DropForeignKey
ALTER TABLE "TaskAssignee" DROP CONSTRAINT "TaskAssignee_taskId_fkey";

-- DropForeignKey
ALTER TABLE "TaskLabel" DROP CONSTRAINT "TaskLabel_labelId_fkey";

-- DropForeignKey
ALTER TABLE "TaskLabel" DROP CONSTRAINT "TaskLabel_taskId_fkey";

-- DropIndex
DROP INDEX "Task_dueDate_idx";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "actorId" TEXT,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "taskId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defaultDueInDays" INTEGER,
ADD COLUMN     "isIntake" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "triagePositionKey" TEXT,
ADD COLUMN     "triageUserId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "ownerAssignedById" TEXT,
ADD COLUMN     "ownerFlagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "ownerRelation" "AssignmentRelation",
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "TaskAssignee" ADD COLUMN     "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "flagAcknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "relation" "AssignmentRelation";

-- AlterTable
ALTER TABLE "TaskLabel" ADD COLUMN     "organizationId" TEXT;

-- Hand-added: backfill organizationId from the parent Task, then NOT NULL.
UPDATE "TaskAssignee" a SET "organizationId" = t."organizationId" FROM "Task" t WHERE t."id" = a."taskId";
UPDATE "TaskLabel" l SET "organizationId" = t."organizationId" FROM "Task" t WHERE t."id" = l."taskId";
ALTER TABLE "TaskAssignee" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "TaskLabel" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateTable
CREATE TABLE "TaskComment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskMention" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "mentionedUserId" TEXT NOT NULL,
    "mentionedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "diffJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyUpdate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "done" JSONB NOT NULL DEFAULT '[]',
    "next" JSONB NOT NULL DEFAULT '[]',
    "blocked" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskComment_organizationId_taskId_createdAt_idx" ON "TaskComment"("organizationId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskMention_organizationId_mentionedUserId_createdAt_idx" ON "TaskMention"("organizationId", "mentionedUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskMention_taskId_sourceKey_mentionedUserId_key" ON "TaskMention"("taskId", "sourceKey", "mentionedUserId");

-- CreateIndex
CREATE INDEX "TaskActivity_organizationId_taskId_createdAt_idx" ON "TaskActivity"("organizationId", "taskId", "createdAt");

-- CreateIndex
CREATE INDEX "WeeklyUpdate_organizationId_weekStart_idx" ON "WeeklyUpdate"("organizationId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyUpdate_organizationId_userId_weekStart_key" ON "WeeklyUpdate"("organizationId", "userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "Label_organizationId_id_key" ON "Label"("organizationId", "id");

-- CreateIndex
CREATE INDEX "Notification_organizationId_userId_createdAt_idx" ON "Notification"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Task_organizationId_ownerId_deletedAt_status_idx" ON "Task"("organizationId", "ownerId", "deletedAt", "status");

-- CreateIndex
CREATE INDEX "Task_organizationId_dueDate_idx" ON "Task"("organizationId", "dueDate");

-- CreateIndex
CREATE INDEX "Task_organizationId_completedAt_idx" ON "Task"("organizationId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Task_organizationId_id_key" ON "Task"("organizationId", "id");

-- CreateIndex
CREATE INDEX "TaskAssignee_organizationId_userId_idx" ON "TaskAssignee"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "TaskLabel_organizationId_labelId_idx" ON "TaskLabel"("organizationId", "labelId");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_triageUserId_fkey" FOREIGN KEY ("triageUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_organizationId_taskId_fkey" FOREIGN KEY ("organizationId", "taskId") REFERENCES "Task"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_organizationId_taskId_fkey" FOREIGN KEY ("organizationId", "taskId") REFERENCES "Task"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLabel" ADD CONSTRAINT "TaskLabel_organizationId_labelId_fkey" FOREIGN KEY ("organizationId", "labelId") REFERENCES "Label"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_organizationId_taskId_fkey" FOREIGN KEY ("organizationId", "taskId") REFERENCES "Task"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMention" ADD CONSTRAINT "TaskMention_organizationId_taskId_fkey" FOREIGN KEY ("organizationId", "taskId") REFERENCES "Task"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMention" ADD CONSTRAINT "TaskMention_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskMention" ADD CONSTRAINT "TaskMention_mentionedById_fkey" FOREIGN KEY ("mentionedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_organizationId_taskId_fkey" FOREIGN KEY ("organizationId", "taskId") REFERENCES "Task"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyUpdate" ADD CONSTRAINT "WeeklyUpdate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyUpdate" ADD CONSTRAINT "WeeklyUpdate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Backfills and security layer (hand-written)
-- =====================================================================

-- ---- Backfills --------------------------------------------------------
-- Owner model: the sole assignee becomes the owner; with several, the
-- creator if they are among them, else the lowest userId. Only current
-- members qualify (the org_member_refs trigger below enforces that from now
-- on). Completed tasks without completedAt get updatedAt.
UPDATE "Task" t SET "ownerId" = pick."userId"
  FROM (
    SELECT DISTINCT ON (a."taskId") a."taskId", a."userId"
      FROM "TaskAssignee" a
      JOIN "Task" t2 ON t2."id" = a."taskId"
      JOIN "Membership" m ON m."userId" = a."userId" AND m."organizationId" = t2."organizationId"
     ORDER BY a."taskId", (a."userId" = t2."createdById") DESC, a."userId"
  ) pick
 WHERE t."id" = pick."taskId" AND t."ownerId" IS NULL;

UPDATE "Task" SET "completedAt" = "updatedAt" WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;

-- ---- Cross-row integrity ------------------------------------------------
-- The owner, the triage user and a mentioned user must be current members
-- of the row's org (the bulkAssign class, on every path including legacy).
-- The notification's task stays inside the org. Comment authorship is
-- immutable.
CREATE TRIGGER org_member_refs BEFORE INSERT OR UPDATE ON "Task"
  FOR EACH ROW EXECUTE FUNCTION app.assert_org_member('ownerId');
CREATE TRIGGER org_member_refs BEFORE INSERT OR UPDATE ON "Project"
  FOR EACH ROW EXECUTE FUNCTION app.assert_org_member('triageUserId');
CREATE TRIGGER org_member_refs BEFORE INSERT OR UPDATE ON "TaskMention"
  FOR EACH ROW EXECUTE FUNCTION app.assert_org_member('mentionedUserId');
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "Notification"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('taskId', 'Task');
CREATE TRIGGER immutable_cols BEFORE UPDATE OF "authorId" ON "TaskComment"
  FOR EACH ROW EXECUTE FUNCTION app.immutable_columns('authorId');

-- ---- TaskAssignee and TaskLabel: direct organizationId policies ----------
-- They replace 0B's EXISTS-on-parent policies now that the composite FKs
-- keep organizationId equal to the parent task's (and, for TaskLabel, the
-- label's). Members edit tasks, so writes are tenant-scoped; app code
-- (assertCanEditTask / assertCanSelfAssign) decides who may act.
DROP POLICY parent_scoped_select ON "TaskAssignee";
DROP POLICY parent_scoped_insert ON "TaskAssignee";
DROP POLICY parent_scoped_update ON "TaskAssignee";
DROP POLICY parent_scoped_delete ON "TaskAssignee";
DROP POLICY parent_scoped_select ON "TaskLabel";
DROP POLICY parent_scoped_insert ON "TaskLabel";
DROP POLICY parent_scoped_update ON "TaskLabel";
DROP POLICY parent_scoped_delete ON "TaskLabel";

CREATE POLICY app_user_select ON "TaskAssignee" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "TaskAssignee" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "TaskAssignee" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "TaskAssignee" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "TaskAssignee" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "TaskAssignee" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "TaskAssignee" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "TaskAssignee" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

CREATE POLICY app_user_select ON "TaskLabel" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "TaskLabel" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "TaskLabel" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "TaskLabel" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "TaskLabel" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "TaskLabel" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "TaskLabel" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "TaskLabel" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- ---- New task tables ----------------------------------------------------
ALTER TABLE "TaskComment"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskMention"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TaskActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WeeklyUpdate" ENABLE ROW LEVEL SECURITY;

-- Comments: members read and write their own; the author or OWNER/ADMIN
-- edits or (soft-)deletes.
CREATE POLICY app_user_select ON "TaskComment" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "TaskComment" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "authorId" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "TaskComment" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("authorId" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("authorId" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_user_delete ON "TaskComment" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("authorId" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));

-- Mentions: tenant-scoped; mentionedById, when set, is the actor.
CREATE POLICY app_user_select ON "TaskMention" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "TaskMention" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("mentionedById" IS NULL OR "mentionedById" = (SELECT app.user_id())));
CREATE POLICY app_user_update ON "TaskMention" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "TaskMention" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));

-- Activity: append-only (no UPDATE or DELETE policy or grant); the actor
-- recorded by a member is the member.
CREATE POLICY app_user_select ON "TaskActivity" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "TaskActivity" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND ("actorId" IS NULL OR "actorId" = (SELECT app.user_id())));

-- Sunday updates: every member reads the org's; each person writes only
-- their own; OWNER/ADMIN may delete.
CREATE POLICY app_user_select ON "WeeklyUpdate" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "WeeklyUpdate" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "WeeklyUpdate" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_user_delete ON "WeeklyUpdate" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("userId" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));

CREATE POLICY app_service_select ON "TaskComment" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "TaskComment" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "TaskComment" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "TaskComment" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "TaskMention" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "TaskMention" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "TaskMention" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "TaskMention" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "TaskActivity" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "TaskActivity" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_select ON "WeeklyUpdate" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "WeeklyUpdate" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "WeeklyUpdate" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "WeeklyUpdate" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "TaskComment", "TaskMention", "TaskActivity", "WeeklyUpdate"
  FROM PUBLIC, app_user, app_service, app_auth, app_legacy;
GRANT SELECT, INSERT, UPDATE, DELETE ON "TaskComment", "TaskMention", "WeeklyUpdate" TO app_user, app_service;
GRANT SELECT, INSERT ON "TaskActivity" TO app_user, app_service;
