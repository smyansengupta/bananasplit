-- Pins and recent pages can point at a Notes folder (and at views kept in
-- the query string, which the existing href check already allows).
ALTER TABLE "Pin" DROP CONSTRAINT "Pin_kind_known";
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_kind_known"
  CHECK ("kind" IN ('page', 'note', 'task', 'event', 'database', 'person', 'file', 'folder'));

ALTER TABLE "RecentVisit" DROP CONSTRAINT "RecentVisit_kind_known";
ALTER TABLE "RecentVisit" ADD CONSTRAINT "RecentVisit_kind_known"
  CHECK ("kind" IN ('page', 'note', 'task', 'event', 'database', 'person', 'file', 'folder'));
