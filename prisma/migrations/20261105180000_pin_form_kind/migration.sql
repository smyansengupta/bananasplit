-- A form can be pinned and shows in Recently visited (src/lib/pins/pages.ts
-- has had "form" in PIN_KINDS since forms got their own titles there), but
-- the Pin and RecentVisit kind checks never learned it: opening a form
-- recorded the visit, the check refused it, and the page's visit action
-- failed with "That change is not allowed." (23514). This adds 'form' to
-- both. No table, policy, grant or function changes.

ALTER TABLE "Pin" DROP CONSTRAINT "Pin_kind_known";
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_kind_known"
  CHECK ("kind" IN ('page', 'note', 'task', 'event', 'database', 'person', 'file', 'folder', 'form'));

ALTER TABLE "RecentVisit" DROP CONSTRAINT "RecentVisit_kind_known";
ALTER TABLE "RecentVisit" ADD CONSTRAINT "RecentVisit_kind_known"
  CHECK ("kind" IN ('page', 'note', 'task', 'event', 'database', 'person', 'file', 'folder', 'form'));
