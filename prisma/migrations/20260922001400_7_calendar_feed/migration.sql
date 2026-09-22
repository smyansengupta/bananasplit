-- =====================================================================
-- Phase 7: Calendar + website feed
-- =====================================================================
-- The Google Calendar mirror and public-feed columns on Event, and the last
-- three legacy child tables (EventAttendee, PollSlot, PollResponse)
-- denormalized with organizationId and composite FKs, so every tenant table
-- now carries its own organizationId. Their policies switch from
-- EXISTS-on-parent to direct organizationId for both roles.
-- NotificationType EVENT_UPDATED / EVENT_CANCELLED shipped in
-- 20260922001300_7_notification_types.
--
-- Generated DDL (prisma migrate diff against the migrated database), with
-- two hand edits: the three organizationId columns are added nullable,
-- backfilled from the parent and only then set NOT NULL; and the spurious
-- `ALTER TABLE "Note" ALTER COLUMN "searchVector" DROP DEFAULT` Prisma emits
-- for the generated tsvector column is removed.

-- CreateEnum
CREATE TYPE "CalendarSyncState" AS ENUM ('NOT_APPLICABLE', 'PENDING', 'SYNCED', 'FAILED');

-- DropForeignKey
ALTER TABLE "EventAttendee" DROP CONSTRAINT "EventAttendee_eventId_fkey";

-- DropForeignKey
ALTER TABLE "PollResponse" DROP CONSTRAINT "PollResponse_pollId_fkey";

-- DropForeignKey
ALTER TABLE "PollResponse" DROP CONSTRAINT "PollResponse_slotId_fkey";

-- DropForeignKey
ALTER TABLE "PollSlot" DROP CONSTRAINT "PollSlot_pollId_fkey";

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "capacityFull" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "googleEtag" TEXT,
ADD COLUMN     "googleEventId" TEXT,
ADD COLUMN     "googleHtmlLink" TEXT,
ADD COLUMN     "googleSyncAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "googleSyncError" TEXT,
ADD COLUMN     "googleSyncState" "CalendarSyncState" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN     "googleSyncedAt" TIMESTAMP(3),
ADD COLUMN     "publicNote" TEXT,
ADD COLUMN     "syncVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable (hand-edited: nullable, backfilled below)
ALTER TABLE "EventAttendee" ADD COLUMN     "organizationId" TEXT;

-- AlterTable (hand-edited: nullable, backfilled below)
ALTER TABLE "PollResponse" ADD COLUMN     "organizationId" TEXT;

-- AlterTable (hand-edited: nullable, backfilled below)
ALTER TABLE "PollSlot" ADD COLUMN     "organizationId" TEXT;

-- Hand-added: backfill organizationId from the parent, then NOT NULL.
UPDATE "EventAttendee" a SET "organizationId" = e."organizationId" FROM "Event" e WHERE e."id" = a."eventId";
UPDATE "PollSlot" s SET "organizationId" = p."organizationId" FROM "AvailabilityPoll" p WHERE p."id" = s."pollId";
UPDATE "PollResponse" r SET "organizationId" = p."organizationId" FROM "AvailabilityPoll" p WHERE p."id" = r."pollId";
ALTER TABLE "EventAttendee" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "PollSlot" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "PollResponse" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AvailabilityPoll_organizationId_id_key" ON "AvailabilityPoll"("organizationId", "id");

-- CreateIndex
CREATE INDEX "Event_googleSyncState_idx" ON "Event"("googleSyncState");

-- CreateIndex
CREATE UNIQUE INDEX "Event_organizationId_googleCalendarId_googleEventId_key" ON "Event"("organizationId", "googleCalendarId", "googleEventId");

-- CreateIndex
CREATE INDEX "EventAttendee_userId_idx" ON "EventAttendee"("userId");

-- CreateIndex
CREATE INDEX "EventAttendee_organizationId_userId_idx" ON "EventAttendee"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "PollResponse_organizationId_pollId_idx" ON "PollResponse"("organizationId", "pollId");

-- CreateIndex
CREATE UNIQUE INDEX "PollSlot_organizationId_id_key" ON "PollSlot"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_organizationId_eventId_fkey" FOREIGN KEY ("organizationId", "eventId") REFERENCES "Event"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollSlot" ADD CONSTRAINT "PollSlot_organizationId_pollId_fkey" FOREIGN KEY ("organizationId", "pollId") REFERENCES "AvailabilityPoll"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollResponse" ADD CONSTRAINT "PollResponse_organizationId_pollId_fkey" FOREIGN KEY ("organizationId", "pollId") REFERENCES "AvailabilityPoll"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollResponse" ADD CONSTRAINT "PollResponse_organizationId_slotId_fkey" FOREIGN KEY ("organizationId", "slotId") REFERENCES "PollSlot"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Security layer (hand-written)
-- =====================================================================
-- 0B's member_of_parent_org trigger on EventAttendee stays: the attendee
-- must be a current member of the event's org on every path. The composite
-- FKs now make a cross-org parent impossible; the policies below replace
-- 0B's EXISTS-on-parent ones (same tenant semantics, index-backed on
-- organizationId). app_legacy keeps its FOR ALL strangler policies.

-- ---- EventAttendee ------------------------------------------------------
DROP POLICY parent_scoped_select ON "EventAttendee";
DROP POLICY parent_scoped_insert ON "EventAttendee";
DROP POLICY parent_scoped_update ON "EventAttendee";
DROP POLICY parent_scoped_delete ON "EventAttendee";
CREATE POLICY app_user_select ON "EventAttendee" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "EventAttendee" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "EventAttendee" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "EventAttendee" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "EventAttendee" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "EventAttendee" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "EventAttendee" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "EventAttendee" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- ---- PollSlot -----------------------------------------------------------
DROP POLICY parent_scoped_select ON "PollSlot";
DROP POLICY parent_scoped_insert ON "PollSlot";
DROP POLICY parent_scoped_update ON "PollSlot";
DROP POLICY parent_scoped_delete ON "PollSlot";
CREATE POLICY app_user_select ON "PollSlot" FOR SELECT TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "PollSlot" FOR INSERT TO app_user WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_update ON "PollSlot" FOR UPDATE TO app_user USING ("organizationId" = (SELECT app.member_org_id())) WITH CHECK ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_delete ON "PollSlot" FOR DELETE TO app_user USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_service_select ON "PollSlot" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "PollSlot" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "PollSlot" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "PollSlot" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- ---- PollResponse -------------------------------------------------------
-- Same row rules as 0B: the slot must belong to the poll (the composite FKs
-- only keep both in the same org), and members respond only as themselves.
-- Guests go through the service path with the org GUC set.
DROP POLICY app_user_select ON "PollResponse";
DROP POLICY app_user_insert ON "PollResponse";
DROP POLICY app_user_update ON "PollResponse";
DROP POLICY app_user_delete ON "PollResponse";
DROP POLICY app_service_select ON "PollResponse";
DROP POLICY app_service_insert ON "PollResponse";
DROP POLICY app_service_update ON "PollResponse";
DROP POLICY app_service_delete ON "PollResponse";
CREATE POLICY app_user_select ON "PollResponse" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "PollResponse" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND "userId" = (SELECT app.user_id())
              AND EXISTS (SELECT 1 FROM "PollSlot" s WHERE s."id" = "PollResponse"."slotId" AND s."pollId" = "PollResponse"."pollId"));
CREATE POLICY app_user_update ON "PollResponse" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND "userId" = (SELECT app.user_id())
              AND EXISTS (SELECT 1 FROM "PollSlot" s WHERE s."id" = "PollResponse"."slotId" AND s."pollId" = "PollResponse"."pollId"));
CREATE POLICY app_user_delete ON "PollResponse" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND "userId" = (SELECT app.user_id()));
CREATE POLICY app_service_select ON "PollResponse" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "PollResponse" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())
              AND EXISTS (SELECT 1 FROM "PollSlot" s WHERE s."id" = "PollResponse"."slotId" AND s."pollId" = "PollResponse"."pollId"));
CREATE POLICY app_service_update ON "PollResponse" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())
              AND EXISTS (SELECT 1 FROM "PollSlot" s WHERE s."id" = "PollResponse"."slotId" AND s."pollId" = "PollResponse"."pollId"));
CREATE POLICY app_service_delete ON "PollResponse" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
