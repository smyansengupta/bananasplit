-- =====================================================================
-- Onboarding flows: profile setup (Flow A) and org setup (Flow B)
-- =====================================================================
-- Generated DDL (prisma migrate diff), then the security layer.
--
--   User.onboardedAt / preferredTitle / themePreference / availability
--       Written by the user on their own row (column grant below). Every
--       existing user is backfilled as onboarded, so only people who sign
--       up from now on run the profile setup.
--   OrgJoinCode
--       One shareable invite code per org. OWNER/ADMIN read and write it;
--       someone who is not a member yet reaches it only through
--       app.org_by_join_code(code), and joins on the service path
--       (withSystemOrgTx(org, { userId })), like an invitation.
--   DatabaseDefinition.tag, OrgSettings.financeDashboardCards,
--   OrgSettings.showMemberAvailability
--       New columns on tables whose policies and table-level grants already
--       cover them (admin-only writes, member reads).

-- AlterTable
ALTER TABLE "DatabaseDefinition" ADD COLUMN     "tag" TEXT;

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "financeDashboardCards" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "showMemberAvailability" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "availability" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "onboardedAt" TIMESTAMP(3),
ADD COLUMN     "preferredTitle" TEXT,
ADD COLUMN     "themePreference" JSONB;

-- CreateTable
CREATE TABLE "OrgJoinCode" (
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedDomain" TEXT,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgJoinCode_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgJoinCode_code_key" ON "OrgJoinCode"("code");

-- AddForeignKey
ALTER TABLE "OrgJoinCode" ADD CONSTRAINT "OrgJoinCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgJoinCode" ADD CONSTRAINT "OrgJoinCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =====================================================================
-- Security layer (hand-written)
-- =====================================================================

-- Existing users skip the profile setup (the flowchart's "Profile complete?").
UPDATE "User" SET "onboardedAt" = CURRENT_TIMESTAMP WHERE "onboardedAt" IS NULL;

-- The user edits these on their own row only (0B app_user_update policy).
GRANT UPDATE ("onboardedAt", "preferredTitle", "themePreference", "availability") ON "User" TO app_user;

-- Codes are upper-case XXXX-XXXX; a bad value never reaches the lookup.
ALTER TABLE "OrgJoinCode" ADD CONSTRAINT "OrgJoinCode_code_format"
  CHECK ("code" ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$');
ALTER TABLE "OrgJoinCode" ADD CONSTRAINT "OrgJoinCode_allowedDomain_format"
  CHECK ("allowedDomain" IS NULL OR "allowedDomain" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');
ALTER TABLE "DatabaseDefinition" ADD CONSTRAINT "DatabaseDefinition_tag_length"
  CHECK ("tag" IS NULL OR char_length("tag") BETWEEN 1 AND 40);

-- OWNER/ADMIN only, like invitations. No DELETE: turn it off or rotate it.
ALTER TABLE "OrgJoinCode" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "OrgJoinCode" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_insert ON "OrgJoinCode" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_user_update ON "OrgJoinCode" FOR UPDATE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()))
  WITH CHECK ("organizationId" = (SELECT app.member_org_id()) AND (SELECT app.is_org_admin()));
CREATE POLICY app_service_select ON "OrgJoinCode" FOR SELECT TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_update ON "OrgJoinCode" FOR UPDATE TO app_service USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id())) WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "OrgJoinCode" FROM PUBLIC, app_user, app_service, app_auth, app_legacy;
GRANT SELECT, INSERT, UPDATE ON "OrgJoinCode" TO app_user;
GRANT SELECT, UPDATE ON "OrgJoinCode" TO app_service;

-- Onboarding "Join with invite code": code -> the org it opens, before the
-- caller is a member. Only a signed-in caller with a VERIFIED email gets a
-- row (the same rule as app.pending_invitations_for_me); the caller checks
-- enabled, the domain and deletion itself so it can say which one failed.
CREATE OR REPLACE FUNCTION app.org_by_join_code(p_code text)
RETURNS TABLE ("organizationId" text, "orgName" text, "orgSlug" text, "orgLogo" jsonb,
               "enabled" boolean, "allowedDomain" text, "deleted" boolean, "memberCount" integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT j."organizationId", o."name", o."slug", o."logo", j."enabled", j."allowedDomain",
         o."deletedAt" IS NOT NULL,
         (SELECT count(*)::int FROM public."Membership" m WHERE m."organizationId" = o."id")
    FROM public."OrgJoinCode" j
    JOIN public."Organization" o ON o."id" = j."organizationId"
    JOIN public."User" u ON u."id" = app.user_id()
   WHERE u."emailVerified" IS NOT NULL
     AND j."code" = upper(btrim(p_code))
$$;

REVOKE ALL ON FUNCTION app.org_by_join_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.org_by_join_code(text) TO app_user;
