-- CRM Phase 3 (docs/features/crm.md, "Phase 3 as built").
--
-- 1. The Inbox's To review shows the CRM's signals (stuck items, someone who
--    went quiet, a renewal coming up...), which members snooze and finish
--    like any other Inbox row. InboxItemState remembers them as
--    "signal:<CrmSuggestion id>": only the key check widens.
--
-- 2. Workflows run in jobs (app_service) and link what they make (a task,
--    a project, a Finance item) to the record that set them off, so the
--    service path may now add ItemLink rows, in the job's organization only.
--    No new table; app.security_manifest is
--    unchanged.

ALTER TABLE "InboxItemState" DROP CONSTRAINT "InboxItemState_itemKey_known";
ALTER TABLE "InboxItemState" ADD CONSTRAINT "InboxItemState_itemKey_known"
  CHECK ("itemKey" ~ '^(invite|task|request|review|update|signal):[A-Za-z0-9_-]{1,64}$');

CREATE POLICY app_service_insert ON "ItemLink" FOR INSERT TO app_service
  WITH CHECK ((SELECT app.org_id()) IS NOT NULL AND "organizationId" = (SELECT app.org_id()));
GRANT INSERT ON "ItemLink" TO app_service;

-- 3. ItemLink's kind check never learned the CRM's kinds (src/lib/links.ts
--    has had crm-person, crm-company and crm-deal since Phase 1), so a task
--    or a file couldn't be linked to a CRM record. It does now.
ALTER TABLE "ItemLink" DROP CONSTRAINT "ItemLink_kinds_known";
ALTER TABLE "ItemLink" ADD CONSTRAINT "ItemLink_kinds_known"
  CHECK ("fromKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget', 'record', 'poll', 'decision', 'announcement', 'crm-person', 'crm-company', 'crm-deal')
     AND "toKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget', 'record', 'poll', 'decision', 'announcement', 'crm-person', 'crm-company', 'crm-deal'));
