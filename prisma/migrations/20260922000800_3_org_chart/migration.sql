-- =====================================================================
-- Phase 3: Org chart
-- =====================================================================
-- Versioned charts (copy-on-version) with positions, and the org's pointer
-- to its published version. History is append-only for app_user: there is
-- no DELETE grant or policy on either table; a draft is discarded by status.

-- CreateEnum
CREATE TYPE "OrgChartVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'DISCARDED');

-- CreateEnum
CREATE TYPE "OrgChartSource" AS ENUM ('UPLOAD', 'MANUAL', 'ROLLBACK', 'SEED');

-- CreateEnum
CREATE TYPE "OrgChartParseStatus" AS ENUM ('PENDING', 'EXTRACTING', 'PARSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "PositionMatchState" AS ENUM ('UNMATCHED', 'SUGGESTED', 'CONFIRMED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "activeOrgChartVersionId" TEXT;

-- CreateTable
CREATE TABLE "OrgChartVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "OrgChartVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "OrgChartSource" NOT NULL,
    "basedOnVersionId" TEXT,
    "sourceFilename" TEXT,
    "sourceMimeType" TEXT,
    "sourceSizeBytes" INTEGER,
    "sourceSha256" TEXT,
    "sourceBlobKey" TEXT,
    "parseStatus" "OrgChartParseStatus",
    "parseAttemptId" TEXT,
    "parseError" TEXT,
    "parseModel" TEXT,
    "parseUsage" JSONB,
    "rawParse" JSONB,
    "openItems" JSONB NOT NULL DEFAULT '[]',
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "editVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgChartVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrgChartPosition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "personName" TEXT,
    "userId" TEXT,
    "matchState" "PositionMatchState" NOT NULL DEFAULT 'UNMATCHED',
    "matchScore" DOUBLE PRECISION,
    "suggestedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reportsToId" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "isAdvisor" BOOLEAN NOT NULL DEFAULT false,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decidesAlone" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceQuote" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rank" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgChartPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgChartVersion_organizationId_status_createdAt_idx" ON "OrgChartVersion"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrgChartVersion_organizationId_number_key" ON "OrgChartVersion"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "OrgChartVersion_organizationId_id_key" ON "OrgChartVersion"("organizationId", "id");

-- CreateIndex
CREATE INDEX "OrgChartPosition_organizationId_versionId_idx" ON "OrgChartPosition"("organizationId", "versionId");

-- CreateIndex
CREATE INDEX "OrgChartPosition_organizationId_userId_idx" ON "OrgChartPosition"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgChartPosition_versionId_key_key" ON "OrgChartPosition"("versionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_activeOrgChartVersionId_key" ON "Organization"("activeOrgChartVersionId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_activeOrgChartVersionId_fkey" FOREIGN KEY ("activeOrgChartVersionId") REFERENCES "OrgChartVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartVersion" ADD CONSTRAINT "OrgChartVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartVersion" ADD CONSTRAINT "OrgChartVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartVersion" ADD CONSTRAINT "OrgChartVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartPosition" ADD CONSTRAINT "OrgChartPosition_organizationId_versionId_fkey" FOREIGN KEY ("organizationId", "versionId") REFERENCES "OrgChartVersion"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartPosition" ADD CONSTRAINT "OrgChartPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgChartPosition" ADD CONSTRAINT "OrgChartPosition_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "OrgChartPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =====================================================================
-- Security layer (hand-written)
-- =====================================================================

-- The org's active chart must be one of its own versions. SECURITY DEFINER
-- like app.assert_same_org, so a missing and a foreign version raise the
-- same 23503 'invalid reference' for every role.
CREATE OR REPLACE FUNCTION app.assert_org_active_chart() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_org text;
BEGIN
  IF NEW."activeOrgChartVersionId" IS NULL
     OR (TG_OP = 'UPDATE' AND NEW."activeOrgChartVersionId" IS NOT DISTINCT FROM OLD."activeOrgChartVersionId") THEN
    RETURN NEW;
  END IF;
  SELECT v."organizationId" INTO v_org FROM public."OrgChartVersion" v WHERE v."id" = NEW."activeOrgChartVersionId";
  IF v_org IS NULL OR v_org IS DISTINCT FROM NEW."id" THEN
    RAISE EXCEPTION 'invalid reference: %.%', TG_TABLE_NAME, 'activeOrgChartVersionId' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER active_chart_same_org BEFORE INSERT OR UPDATE OF "activeOrgChartVersionId" ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION app.assert_org_active_chart();

-- reportsTo stays inside the org (the same-version rule is checked in code
-- and at publish); authorship of a version is immutable.
CREATE TRIGGER same_org_refs BEFORE INSERT OR UPDATE ON "OrgChartPosition"
  FOR EACH ROW EXECUTE FUNCTION app.assert_same_org('reportsToId', 'OrgChartPosition');
CREATE TRIGGER immutable_cols BEFORE UPDATE OF "createdById" ON "OrgChartVersion"
  FOR EACH ROW EXECUTE FUNCTION app.immutable_columns('createdById');

ALTER TABLE "OrgChartVersion"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrgChartPosition" ENABLE ROW LEVEL SECURITY;

-- Members see only the PUBLISHED version; OWNER/ADMIN see drafts and
-- history and are the only writers. No DELETE for app_user.
CREATE POLICY app_user_select ON "OrgChartVersion" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("status" = 'PUBLISHED' OR (SELECT app.is_org_admin())));
CREATE POLICY app_user_insert ON "OrgChartVersion" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin())
              AND "createdById" = (SELECT app.user_id()));
CREATE POLICY app_user_update ON "OrgChartVersion" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "OrgChartVersion" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "OrgChartVersion" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "OrgChartVersion" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "OrgChartVersion" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

-- Positions mirror their version through EXISTS on a visible version (the
-- version's own RLS applies inside the subquery).
CREATE POLICY app_user_select ON "OrgChartPosition" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND EXISTS (SELECT 1 FROM "OrgChartVersion" v WHERE v."id" = "OrgChartPosition"."versionId"));
CREATE POLICY app_user_insert ON "OrgChartPosition" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "OrgChartPosition" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "OrgChartPosition" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "OrgChartPosition" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "OrgChartPosition" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "OrgChartPosition" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "OrgChartVersion", "OrgChartPosition" FROM PUBLIC, app_user, app_service, app_auth, app_legacy;
GRANT SELECT, INSERT, UPDATE ON "OrgChartVersion", "OrgChartPosition" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "OrgChartVersion", "OrgChartPosition" TO app_service;
REVOKE EXECUTE ON FUNCTION app.assert_org_active_chart() FROM PUBLIC;
