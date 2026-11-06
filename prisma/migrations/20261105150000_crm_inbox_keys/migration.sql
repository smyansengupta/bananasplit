-- The CRM's two kinds of Inbox row, together. 20261105110000_crm_outreach
-- widened InboxItemState's key check for "crm:" rows (the follow-up queue)
-- and 20261105120000_crm_automation for "signal:" rows (CRM signals); each
-- was written without the other, and the later one replaced the check, so
-- this restates it with both. No table, policy or grant changes.

ALTER TABLE "InboxItemState" DROP CONSTRAINT "InboxItemState_itemKey_known";
ALTER TABLE "InboxItemState" ADD CONSTRAINT "InboxItemState_itemKey_known"
  CHECK ("itemKey" ~ '^(invite|task|request|review|update|signal|crm):[A-Za-z0-9_-]{1,64}$');
