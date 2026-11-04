-- Booking links in Meetings (docs/features/booking.md).
--
-- 1. CrmBookingPage becomes the booking link for both kinds: the
--    organization's (ownerUserId NULL, as before) and each member's own
--    (ownerUserId set; one per member per space, unique). New columns: its
--    zone, its weekly hours and one-off dates, the other lengths a guest may
--    pick, video or a place, reminders, and a daily cap. Existing pages keep
--    working unchanged (hours NULL reads the hosts' availability as before).
-- 2. Booking: one row per meeting booked on a link, with the guest, their
--    answers, the calendar event it made, its state and the hash of the
--    guest's manage link. A partial unique index keeps one live booking per
--    host per start (the booking code also serializes each host with an
--    advisory lock and checks again under it).
--    RLS: members read the bookings they host, owners and admins read all
--    of the organization's. Nothing in the app writes them as app_user (the
--    public page, the guest's link and the jobs write on the service path,
--    after the app checked who may), so app_user has SELECT only and no
--    write policy, and app.security_manifest()'s tenant-only allowlist is
--    unchanged (no new app_user write policy).
-- 3. app.crm_public_target(kind, key) is redefined from 20261105110000 with
--    one kind more, 'booking-guest': a booking by its manage token's hash.
--    Same rule as the others: ids only, service role only.
-- 4. app.booking_host_busy(page, from, to, except): when a link's hosts are
--    already busy, as times only (no titles, no ids), from every space they
--    are in: meetings they host or were asked to and did not decline, and
--    everything on their Personal calendar (its Google import too). In the
--    caller's organization context, for that page's hosts who are still
--    members, only. Service role only.
-- 5. NotificationType gains MEETING_BOOKED (booked, moved or cancelled).


-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'CANCELLED');


-- AlterTable
ALTER TABLE "CrmBookingPage" ADD COLUMN     "dateOverrides" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "durations" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "hours" JSONB,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "maxPerDay" INTEGER,
ADD COLUMN     "ownerUserId" TEXT,
ADD COLUMN     "reminderMinutes" INTEGER[] DEFAULT ARRAY[1440, 60]::INTEGER[],
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "video" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT NOT NULL,
    "guestTimeZone" TEXT,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "verifiedAt" TIMESTAMP(3),
    "tokenHash" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "personId" TEXT,
    "needsHost" BOOLEAN NOT NULL DEFAULT false,
    "remindedOffsets" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_eventId_key" ON "Booking"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_tokenHash_key" ON "Booking"("tokenHash");

-- CreateIndex
CREATE INDEX "Booking_organizationId_pageId_createdAt_idx" ON "Booking"("organizationId", "pageId", "createdAt");

-- CreateIndex
CREATE INDEX "Booking_organizationId_hostUserId_startsAt_idx" ON "Booking"("organizationId", "hostUserId", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_organizationId_guestEmail_idx" ON "Booking"("organizationId", "guestEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_organizationId_id_key" ON "Booking"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CrmBookingPage_organizationId_ownerUserId_key" ON "CrmBookingPage"("organizationId", "ownerUserId");

-- AddForeignKey
ALTER TABLE "CrmBookingPage" ADD CONSTRAINT "CrmBookingPage_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_organizationId_pageId_fkey" FOREIGN KEY ("organizationId", "pageId") REFERENCES "CrmBookingPage"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MEETING_BOOKED';

-- One live booking per host per start (the booking code's lock is the main guard).
CREATE UNIQUE INDEX "Booking_host_start_live_key" ON "Booking"("hostUserId", "startsAt")
  WHERE "status" = 'BOOKED';

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_ends_after_start" CHECK ("endsAt" > "startsAt");
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_guest_sizes"
  CHECK (char_length("guestName") BETWEEN 1 AND 120 AND char_length("guestEmail") BETWEEN 3 AND 254);
-- A personal link books its owner and nobody else.
ALTER TABLE "CrmBookingPage" ADD CONSTRAINT "CrmBookingPage_owner_hosts"
  CHECK ("ownerUserId" IS NULL OR "hostIds" = ARRAY["ownerUserId"]);

-- ---- Booking ---------------------------------------------------------------
ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "Booking" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("hostUserId" = (SELECT app.user_id()) OR (SELECT app.is_org_admin())));
CREATE POLICY app_service_select ON "Booking" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "Booking" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "Booking" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "Booking" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "Booking" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT ON "Booking" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Booking" TO app_service;

-- ---- app.crm_public_target: one kind more -----------------------------------
CREATE OR REPLACE FUNCTION app.crm_public_target(p_kind text, p_key text)
RETURNS TABLE ("organizationId" text, "id" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT b."organizationId", b."id" FROM public."CrmBookingPage" b
   WHERE p_kind = 'booking' AND b."slug" = p_key AND b."active"
  UNION ALL
  SELECT k."organizationId", k."id" FROM public."Booking" k
   WHERE p_kind = 'booking-guest' AND k."tokenHash" = p_key
  UNION ALL
  SELECT g."organizationId", g."id" FROM public."CrmGuestLink" g
   WHERE p_kind = 'guest' AND g."tokenHash" = p_key AND g."revokedAt" IS NULL
     AND (g."expiresAt" IS NULL OR g."expiresAt" > now())
  UNION ALL
  SELECT p."organizationId", p."id" FROM public."CrmPerson" p
   WHERE p_kind = 'self' AND p."selfUpdateTokenHash" = p_key AND p."deletedAt" IS NULL
  UNION ALL
  SELECT m."organizationId", m."id" FROM public."CrmMemberSettings" m
   WHERE p_kind = 'bcc' AND m."bccToken" = p_key
  UNION ALL
  SELECT e."organizationId", e."id" FROM public."CrmEmailMessage" e
   WHERE p_kind = 'track' AND e."trackingToken" = p_key
$$;
REVOKE ALL ON FUNCTION app.crm_public_target(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.crm_public_target(text, text) TO app_service;

-- ---- app.booking_host_busy ----------------------------------------------------
CREATE FUNCTION app.booking_host_busy(p_page text, p_from timestamp, p_to timestamp, p_except text)
RETURNS TABLE ("userId" text, "startsAt" timestamp, "endsAt" timestamp)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  WITH hosts AS (
    SELECT m."userId"
      FROM public."CrmBookingPage" b
      JOIN public."Membership" m
        ON m."organizationId" = b."organizationId" AND m."userId" = ANY (b."hostIds")
     WHERE app.org_id() IS NOT NULL
       AND b."organizationId" = app.org_id()
       AND b."id" = p_page
  ),
  live AS (
    SELECT e."id", e."organizationId", e."hostUserId", e."startsAt", e."endsAt"
      FROM public."Event" e
     WHERE e."deletedAt" IS NULL AND NOT e."allDay"
       AND e."startsAt" < p_to AND e."endsAt" > p_from
       AND e."id" IS DISTINCT FROM p_except
  )
  SELECT h."userId", e."startsAt", e."endsAt"
    FROM hosts h JOIN live e ON e."hostUserId" = h."userId"
  UNION
  SELECT h."userId", e."startsAt", e."endsAt"
    FROM hosts h
    JOIN public."EventAttendee" a ON a."userId" = h."userId" AND a."rsvp" <> 'NO'
    JOIN live e ON e."id" = a."eventId"
  UNION
  SELECT h."userId", e."startsAt", e."endsAt"
    FROM hosts h
    JOIN public."Organization" o ON o."personalOwnerId" = h."userId" AND o."kind" = 'PERSONAL'
    JOIN live e ON e."organizationId" = o."id"
$$;
REVOKE ALL ON FUNCTION app.booking_host_busy(text, timestamp, timestamp, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.booking_host_busy(text, timestamp, timestamp, text) TO app_service;
