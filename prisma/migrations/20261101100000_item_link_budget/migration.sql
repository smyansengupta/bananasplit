-- Budget lines can be linked too (the Linked panel: a meeting's snacks
-- come out of "Events budget", which shows what's left). Only the check on
-- which kinds a link may join changes.
ALTER TABLE "ItemLink" DROP CONSTRAINT "ItemLink_kinds_known";
ALTER TABLE "ItemLink" ADD CONSTRAINT "ItemLink_kinds_known"
  CHECK ("fromKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget')
     AND "toKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget'));
