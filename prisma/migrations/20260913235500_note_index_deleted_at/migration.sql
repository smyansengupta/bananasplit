-- Replace the organizationId-only index with a compound one covering the
-- common list-query filter (organizationId + deletedAt), matching the
-- Task/Transaction indexes added earlier in this migration set.
DROP INDEX "Note_organizationId_idx";
CREATE INDEX "Note_organizationId_deletedAt_idx" ON "Note"("organizationId", "deletedAt");
