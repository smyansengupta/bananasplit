-- Event types an organization names for itself.
--
-- Event.kind was an enum — WORKSHOP, INFO_SESSION, HACKATHON, SOCIAL,
-- BOARD_MEETING, OTHER — which is one kind of student club's vocabulary.
-- Bananasplit is for organizations, and a lab, a team or a society has its
-- own words. EventTag holds them, one row per type per org, and Event
-- points at one (or at none, which is what OTHER meant).
--
-- Nothing is lost on the way: every org keeps exactly the types its own
-- events were using, as rows it can now rename, recolour, reorder and
-- delete. An org with no events at all starts from a short neutral set.

CREATE TABLE "EventTag" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTag_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EventTag" ADD CONSTRAINT "EventTag_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "EventTag_organizationId_sortOrder_idx" ON "EventTag"("organizationId", "sortOrder");

-- One name per org, however it is cased: "Workshop" and "workshop" are the
-- same type. Prisma cannot declare an expression index, so it lives here.
CREATE UNIQUE INDEX "EventTag_organizationId_lower_name_key"
  ON "EventTag"("organizationId", lower("name"));

ALTER TABLE "EventTag" ADD CONSTRAINT "EventTag_name_length"
  CHECK (char_length("name") BETWEEN 1 AND 40);
-- A chart token, never a literal colour, so a club theme restyles them.
ALTER TABLE "EventTag" ADD CONSTRAINT "EventTag_color_known"
  CHECK ("color" IS NULL OR "color" IN ('chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'));

-- ---- carrying the old kinds over ------------------------------------

-- The label and colour each old enum member becomes, and where it sits.
CREATE TEMPORARY TABLE "_kind_map" ("kind" TEXT, "name" TEXT, "color" TEXT, "ord" INTEGER) ON COMMIT DROP;
INSERT INTO "_kind_map" VALUES
  ('WORKSHOP',      'Workshop',      'chart-1', 0),
  ('INFO_SESSION',  'Info session',  'chart-2', 1),
  ('HACKATHON',     'Hackathon',     'chart-3', 2),
  ('SOCIAL',        'Social',        'chart-4', 3),
  ('BOARD_MEETING', 'Board meeting', 'chart-5', 4);

-- Every org keeps the types its own events actually used. OTHER is not a
-- type: it becomes "no type", which is NULL.
INSERT INTO "EventTag" ("id", "organizationId", "name", "color", "sortOrder")
SELECT
  'etag_' || md5(e."organizationId" || ':' || m."kind"),
  e."organizationId",
  m."name",
  m."color",
  m."ord"
FROM (SELECT DISTINCT "organizationId", "kind"::text AS "kind" FROM "Event") e
JOIN "_kind_map" m ON m."kind" = e."kind"
GROUP BY e."organizationId", m."kind", m."name", m."color", m."ord";

-- An org with no events of its own starts from a neutral set it can edit.
INSERT INTO "EventTag" ("id", "organizationId", "name", "color", "sortOrder")
SELECT 'etag_' || md5(o."id" || ':' || d."name"), o."id", d."name", d."color", d."ord"
FROM "Organization" o
CROSS JOIN (VALUES
  ('Meeting',  'chart-1', 0),
  ('Workshop', 'chart-2', 1),
  ('Social',   'chart-3', 2),
  ('Deadline', 'chart-4', 3)
) AS d("name", "color", "ord")
WHERE NOT EXISTS (SELECT 1 FROM "EventTag" t WHERE t."organizationId" = o."id");

ALTER TABLE "Event" ADD COLUMN "tagId" TEXT;

UPDATE "Event" e
   SET "tagId" = t."id"
  FROM "_kind_map" m
  JOIN "EventTag" t ON t."name" = m."name"
 WHERE m."kind" = e."kind"::text
   AND t."organizationId" = e."organizationId";

ALTER TABLE "Event" ADD CONSTRAINT "Event_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "EventTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "Event_organizationId_deletedAt_kind_startsAt_idx";
CREATE INDEX "Event_organizationId_deletedAt_tagId_startsAt_idx"
  ON "Event"("organizationId", "deletedAt", "tagId", "startsAt");

ALTER TABLE "Event" DROP COLUMN "kind";
DROP TYPE "EventKind";

-- ---- row security ---------------------------------------------------

-- An event type is the organization's own configuration, like its labels
-- and its theme: every member reads them (the calendar draws them), and
-- owners and admins write them. Admin-gated writes need no entry in
-- app.security_manifest's tenant-write allowlist.
ALTER TABLE "EventTag" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "EventTag" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "EventTag" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "EventTag" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "EventTag" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));

CREATE POLICY app_service_select ON "EventTag" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "EventTag" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "EventTag" FOR UPDATE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()))
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "EventTag" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "EventTag" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON "EventTag" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "EventTag" TO app_service;
