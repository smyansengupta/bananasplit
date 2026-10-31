-- Budget lines and database rows can be linked too (the Linked panel: a
-- meeting's snacks come out of "Events budget", which shows what's left; an
-- applicant's row links to the interview meeting). Only the check on which
-- kinds a link may join changes.
ALTER TABLE "ItemLink" DROP CONSTRAINT "ItemLink_kinds_known";
ALTER TABLE "ItemLink" ADD CONSTRAINT "ItemLink_kinds_known"
  CHECK ("fromKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget', 'record')
     AND "toKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget', 'record'));
