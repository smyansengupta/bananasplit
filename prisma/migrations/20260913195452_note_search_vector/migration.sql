-- AlterTable
-- Generated column: stays in sync automatically whenever title/contentText
-- change, no application code or trigger needed to keep it current.
ALTER TABLE "Note" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce("contentText", ''))
  ) STORED;

-- CreateIndex
CREATE INDEX "Note_searchVector_idx" ON "Note" USING GIN ("searchVector");
