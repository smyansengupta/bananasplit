-- CRM Phase 3 (docs/features/crm.md, "Phase 3 as built"): the Inbox's
-- To review shows the CRM's signals (stuck items, someone who went quiet,
-- a renewal coming up...), which members snooze and finish like any other
-- Inbox row. InboxItemState remembers them as "signal:<CrmSuggestion id>".
-- Only the key check widens; no table, policy or grant changes.

ALTER TABLE "InboxItemState" DROP CONSTRAINT "InboxItemState_itemKey_known";
ALTER TABLE "InboxItemState" ADD CONSTRAINT "InboxItemState_itemKey_known"
  CHECK ("itemKey" ~ '^(invite|task|request|review|update|signal):[A-Za-z0-9_-]{1,64}$');
