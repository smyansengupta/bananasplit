-- C2: record which reader produced an org-chart draft.
--
-- The built-in parser (src/server/org-chart/parse) reads most documents
-- with no API key, and Claude is only the backup, so a draft has to say
-- where it came from and how much of the document was understood:
--   parseMethod      BUILTIN | CLAUDE | TEMPLATE | MANUAL
--   parseConfidence  0 to 1, the built-in parser's coverage score
--   parseReport      the report shown to the admin (counts, unplaced lines)
--
-- No new table, so no new RLS policies and no new GRANTs: OrgChartVersion
-- already has per-command policies for app_user and app_service
-- (20260922000800_3_org_chart) and table-level GRANTs, which cover columns
-- added later. The reviewed grant matrix in prisma/rls/phases.mjs is
-- per-table and therefore unchanged (OrgChartVersion: SIU / SIUD / -).
-- parseReport is admin-only data: it is never selected into a member-facing
-- read (src/server/org-chart/queries.ts).

-- CreateEnum
CREATE TYPE "OrgChartParseMethod" AS ENUM ('BUILTIN', 'CLAUDE', 'TEMPLATE', 'MANUAL');

-- AlterTable
ALTER TABLE "OrgChartVersion" ADD COLUMN     "parseConfidence" DOUBLE PRECISION,
ADD COLUMN     "parseMethod" "OrgChartParseMethod",
ADD COLUMN     "parseReport" JSONB;

-- Existing history keeps its provenance: every draft that ran through the
-- old importer was read by Claude; everything else was built in the portal.
UPDATE "OrgChartVersion"
   SET "parseMethod" = CASE WHEN "source" = 'UPLOAD' THEN 'CLAUDE'::"OrgChartParseMethod"
                            ELSE 'MANUAL'::"OrgChartParseMethod" END;
