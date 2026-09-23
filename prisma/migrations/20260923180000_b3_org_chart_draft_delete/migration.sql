-- =====================================================================
-- B3 (Org Chart): the draft editor removes positions from a DRAFT
-- =====================================================================
-- History stays append-only for app_user: OWNER/ADMIN may delete a
-- position only while its version is a DRAFT (removing a position the
-- parse invented, or one the admin no longer wants, before publishing).
-- Published, archived and discarded versions keep every position, and
-- OrgChartVersion still has no app_user DELETE policy (a draft is
-- discarded by status). The EXISTS runs under the version's own RLS, so a
-- member, who cannot see drafts, matches nothing.
CREATE POLICY app_user_delete ON "OrgChartPosition" FOR DELETE TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND (SELECT app.is_org_admin())
         AND EXISTS (SELECT 1 FROM "OrgChartVersion" v
                      WHERE v."id" = "OrgChartPosition"."versionId"
                        AND v."organizationId" = "OrgChartPosition"."organizationId"
                        AND v."status" = 'DRAFT'));

GRANT DELETE ON "OrgChartPosition" TO app_user;
