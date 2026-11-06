-- CRM Phase 4 (AI): tasks, notes and meetings link to CRM records.
--
-- src/lib/links.ts gained the CRM's link kinds (crm-person, crm-company,
-- crm-deal) in Phase 1, but ItemLink's check constraint still listed only
-- the workspace's own kinds, so a link to a CRM record was refused by the
-- database. The review queue's "promises become tasks" links each task it
-- makes to its person, company or item, so the constraint now names them.
-- No table, policy or grant changes: ItemLink's RLS already covers every row.

ALTER TABLE "ItemLink" DROP CONSTRAINT "ItemLink_kinds_known";
ALTER TABLE "ItemLink" ADD CONSTRAINT "ItemLink_kinds_known"
  CHECK ("fromKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget', 'record', 'poll', 'decision', 'announcement', 'crm-person', 'crm-company', 'crm-deal')
     AND "toKind" IN ('task', 'event', 'note', 'file', 'person', 'database', 'transaction', 'form', 'budget', 'record', 'poll', 'decision', 'announcement', 'crm-person', 'crm-company', 'crm-deal'));
