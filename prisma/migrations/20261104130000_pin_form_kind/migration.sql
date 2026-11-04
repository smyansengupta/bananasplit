-- Pins and recent pages can point at a form (src/lib/pins/pages.ts lists
-- "form" as a kind); the checks didn't, so pinning a form, or opening one
-- (which records it as a recent page), was refused.
ALTER TABLE "Pin" DROP CONSTRAINT "Pin_kind_known";
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_kind_known"
  CHECK ("kind" IN ('page', 'note', 'task', 'event', 'database', 'person', 'file', 'folder', 'form'));

ALTER TABLE "RecentVisit" DROP CONSTRAINT "RecentVisit_kind_known";
ALTER TABLE "RecentVisit" ADD CONSTRAINT "RecentVisit_kind_known"
  CHECK ("kind" IN ('page', 'note', 'task', 'event', 'database', 'person', 'file', 'folder', 'form'));
