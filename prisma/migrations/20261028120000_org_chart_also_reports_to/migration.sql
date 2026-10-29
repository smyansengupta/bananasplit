-- Org chart: more than one reporting line. A position keeps one manager
-- (reportsToId, the line the tree is drawn from) and may also report to
-- other positions of the same version (dotted lines, drawn dashed). They
-- are copied with the positions, like reportsToId, so drafts, publish,
-- rollback and imports carry them. The table's existing grants and org
-- policies cover the new column.
ALTER TABLE "OrgChartPosition" ADD COLUMN "alsoReportsToIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "OrgChartPosition" ADD CONSTRAINT "OrgChartPosition_alsoReportsToIds_check"
  CHECK (coalesce(cardinality("alsoReportsToIds"), 0) <= 10
         AND NOT ("id" = ANY (coalesce("alsoReportsToIds", ARRAY[]::text[]))));

-- Each extra manager is another position of the same version and org, named
-- once. SECURITY DEFINER like app.assert_same_org, so a missing id and one
-- from another org raise the same 23503 for every role.
CREATE OR REPLACE FUNCTION app.assert_also_reports_to() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW."alsoReportsToIds" IS NULL OR cardinality(NEW."alsoReportsToIds") = 0 THEN
    RETURN NEW;
  END IF;
  IF cardinality(NEW."alsoReportsToIds") <> (SELECT count(DISTINCT x) FROM unnest(NEW."alsoReportsToIds") x)
     OR EXISTS (
       SELECT 1 FROM unnest(NEW."alsoReportsToIds") x
        WHERE NOT EXISTS (SELECT 1 FROM public."OrgChartPosition" p
                           WHERE p."id" = x
                             AND p."organizationId" = NEW."organizationId"
                             AND p."versionId" = NEW."versionId")) THEN
    RAISE EXCEPTION 'invalid reference: %.%', TG_TABLE_NAME, 'alsoReportsToIds' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION app.assert_also_reports_to() FROM PUBLIC;

CREATE TRIGGER also_reports_to_same_version
  BEFORE INSERT OR UPDATE OF "alsoReportsToIds", "organizationId", "versionId" ON "OrgChartPosition"
  FOR EACH ROW EXECUTE FUNCTION app.assert_also_reports_to();
