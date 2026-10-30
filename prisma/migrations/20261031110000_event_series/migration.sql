-- Repeating meetings as a linked series (docs/features/meetings.md): every
-- week is its own Event, and the weeks share a seriesId so an edit or a
-- delete can apply to "this one" or "this and the ones after", and a
-- series can be extended or ended. Google Calendar gets each one as an
-- ordinary event. The table's existing grants and policies cover it.
ALTER TABLE "Event" ADD COLUMN "seriesId" TEXT;
ALTER TABLE "Event" ADD CONSTRAINT "Event_seriesId_length"
  CHECK ("seriesId" IS NULL OR char_length("seriesId") BETWEEN 1 AND 40);
CREATE INDEX "Event_organizationId_seriesId_startsAt_idx"
  ON "Event"("organizationId", "seriesId", "startsAt");
