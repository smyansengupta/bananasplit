-- A kept copy of a report freezes the rows its taker could see (a scheduled
-- send takes one as the report's maker). Showing it to everyone who can open
-- the report would share those rows with people who can't see them, so a
-- copy is now its taker's own, and owners' and admins' (who see the
-- databases behind it anyway).

DROP POLICY app_user_select ON "ReportSnapshot";
CREATE POLICY app_user_select ON "ReportSnapshot" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ("takenById" = (SELECT app.user_id()) OR (SELECT app.is_org_admin()))
         AND EXISTS (SELECT 1 FROM "Report" r
                      WHERE r."organizationId" = "ReportSnapshot"."organizationId"
                        AND r."id" = "ReportSnapshot"."reportId"));
