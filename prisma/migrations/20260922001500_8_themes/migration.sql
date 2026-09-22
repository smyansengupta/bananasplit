-- =====================================================================
-- Phase 8: Themes
-- =====================================================================
-- One OrgTheme row per org (created on first save; no row = the default
-- preset). Generated DDL (prisma migrate diff), then the security layer.
-- Colour values are strict hex, validated in app code on write and again at
-- render (src/lib/theme), which is what blocks CSS injection through the
-- server-rendered <style>.

-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateTable
CREATE TABLE "OrgTheme" (
    "organizationId" TEXT NOT NULL,
    "preset" TEXT NOT NULL DEFAULT 'default',
    "mode" "ThemeMode" NOT NULL DEFAULT 'SYSTEM',
    "lockMode" BOOLEAN NOT NULL DEFAULT false,
    "light" JSONB NOT NULL,
    "dark" JSONB,
    "tokens" JSONB NOT NULL DEFAULT '{}',
    "contrastWarnings" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgTheme_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "OrgTheme" ADD CONSTRAINT "OrgTheme_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Security layer (hand-written)
-- =====================================================================
-- Members read (the org layout renders the theme for everyone); OWNER/ADMIN
-- insert, update and delete (delete = reset to the default preset).
ALTER TABLE "OrgTheme" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "OrgTheme" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()));
CREATE POLICY app_user_insert ON "OrgTheme" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "OrgTheme" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_delete ON "OrgTheme" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "OrgTheme" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_insert ON "OrgTheme" FOR INSERT TO app_service WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "OrgTheme" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "OrgTheme" FOR DELETE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "OrgTheme" FROM PUBLIC, app_user, app_service, app_auth, app_legacy;
GRANT SELECT, INSERT, UPDATE, DELETE ON "OrgTheme" TO app_user, app_service;
