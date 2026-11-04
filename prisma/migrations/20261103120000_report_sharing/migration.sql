-- Reports shared outside the organization, and deleted for good.
--
--   Report.linkTokenHash: the view-only link (/r/{token}). Only sha256 of
--   the token is kept (hex); the token exists only in the link shown to the
--   editor who turned it on or made a new one. Null is off. A link needs a
--   report the organization shares (CHECK), so making a report "Only me"
--   turns its link off in the same UPDATE.
--   ReportInvite: an email address outside (or inside) the organization the
--   report is shared with; whoever signs in with that verified address
--   opens it read-only (/r/invite/{reportId}). Only the report's editors
--   (its maker, or an owner/admin on a shared one) read, add and remove them.
--   Report DELETE: its editors delete it for good; its kept copies and
--   invites go with it (ON DELETE CASCADE).
--
-- The public pages find a report by token, or by report and email, through
-- the definer functions below on the service path (no org context), then
-- read on the service path scoped to that organization.

-- AlterTable
ALTER TABLE "Report" ADD COLUMN "linkTokenHash" TEXT,
ADD COLUMN "linkCreatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReportInvite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Report_linkTokenHash_key" ON "Report"("linkTokenHash");

-- CreateIndex
CREATE INDEX "ReportInvite_organizationId_reportId_idx" ON "ReportInvite"("organizationId", "reportId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportInvite_reportId_email_key" ON "ReportInvite"("reportId", "email");

-- AddForeignKey
ALTER TABLE "ReportInvite" ADD CONSTRAINT "ReportInvite_organizationId_reportId_fkey" FOREIGN KEY ("organizationId", "reportId") REFERENCES "Report"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: checks, RLS, grants and the lookups.
-- ---------------------------------------------------------------------------

ALTER TABLE "Report" ADD CONSTRAINT "Report_link_needs_organization"
  CHECK ("linkTokenHash" IS NULL OR "access" = 'ORGANIZATION');
ALTER TABLE "Report" ADD CONSTRAINT "Report_link_token_hash_format"
  CHECK ("linkTokenHash" IS NULL OR "linkTokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ReportInvite" ADD CONSTRAINT "ReportInvite_email_normalized"
  CHECK ("email" = lower(btrim("email")) AND length("email") BETWEEN 3 AND 254 AND position('@' in "email") > 1);

-- ---- Report: delete, and the link columns ----------------------------------
-- The same people as the UPDATE policy: whoever made it, or an owner/admin
-- on a shared one.
CREATE POLICY app_user_delete ON "Report" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("createdById" = (SELECT app.user_id())
              OR ("access" = 'ORGANIZATION' AND (SELECT app.is_org_admin()))));

GRANT DELETE ON "Report" TO app_user;
GRANT UPDATE ("linkTokenHash", "linkCreatedAt") ON "Report" TO app_user;

-- ---- ReportInvite -----------------------------------------------------------
-- The report's own SELECT policy applies inside the EXISTS too.
ALTER TABLE "ReportInvite" ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_user_select ON "ReportInvite" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND EXISTS (SELECT 1 FROM "Report" r
                      WHERE r."organizationId" = "ReportInvite"."organizationId"
                        AND r."id" = "ReportInvite"."reportId"
                        AND (r."createdById" = (SELECT app.user_id())
                             OR (r."access" = 'ORGANIZATION' AND (SELECT app.is_org_admin())))));
CREATE POLICY app_user_insert ON "ReportInvite" FOR INSERT TO app_user
  WITH CHECK ("organizationId" = (SELECT app.member_org_id())
              AND EXISTS (SELECT 1 FROM "Report" r
                           WHERE r."organizationId" = "ReportInvite"."organizationId"
                             AND r."id" = "ReportInvite"."reportId"
                             AND r."access" = 'ORGANIZATION'
                             AND r."archivedAt" IS NULL
                             AND (r."createdById" = (SELECT app.user_id())
                                  OR (SELECT app.is_org_admin()))));
CREATE POLICY app_user_delete ON "ReportInvite" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND EXISTS (SELECT 1 FROM "Report" r
                      WHERE r."organizationId" = "ReportInvite"."organizationId"
                        AND r."id" = "ReportInvite"."reportId"
                        AND (r."createdById" = (SELECT app.user_id())
                             OR (r."access" = 'ORGANIZATION' AND (SELECT app.is_org_admin())))));
CREATE POLICY app_service_select ON "ReportInvite" FOR SELECT TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
CREATE POLICY app_service_delete ON "ReportInvite" FOR DELETE TO app_service
  USING ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));

REVOKE ALL ON "ReportInvite" FROM PUBLIC, app_user, app_service, app_auth;
GRANT SELECT, INSERT, DELETE ON "ReportInvite" TO app_user;
GRANT SELECT, DELETE ON "ReportInvite" TO app_service;

-- ---- The public lookups (service path, no org context) -------------------
-- A live, organization-shared report by its link's token hash.
CREATE OR REPLACE FUNCTION app.report_link_target(p_hash text)
RETURNS TABLE ("organizationId" text, "reportId" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT r."organizationId", r."id" FROM public."Report" r
   WHERE r."linkTokenHash" = p_hash
     AND r."access" = 'ORGANIZATION'
     AND r."archivedAt" IS NULL
$$;
REVOKE ALL ON FUNCTION app.report_link_target(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.report_link_target(text) TO app_service;

-- A live, organization-shared report this email is invited to.
CREATE OR REPLACE FUNCTION app.report_invite_target(p_report_id text, p_email text)
RETURNS TABLE ("organizationId" text, "reportId" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT r."organizationId", r."id" FROM public."ReportInvite" i
    JOIN public."Report" r ON r."organizationId" = i."organizationId" AND r."id" = i."reportId"
   WHERE i."reportId" = p_report_id
     AND i."email" = lower(btrim(p_email))
     AND r."access" = 'ORGANIZATION'
     AND r."archivedAt" IS NULL
$$;
REVOKE ALL ON FUNCTION app.report_invite_target(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.report_invite_target(text, text) TO app_service;
