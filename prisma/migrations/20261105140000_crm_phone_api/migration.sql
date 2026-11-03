-- CRM Phase 5: phone, quotes, API (docs/features/crm.md, "Phase 5 as built").
--
-- Columns only, on tables that already have RLS, policies and grants
-- (20261105090000_crm): no new table, no new policy, no function, so
-- app.security_manifest() is unchanged.
--
-- 1. CrmSettings.phone: the organization's calls-and-texts settings (which
--    provider, recording policy and its notice, quiet hours for texts,
--    calling hours, the voicemail to drop). CrmSettings is written only by
--    owners, admins and CRM managers (its existing policies); the app lets
--    owners and admins change this part.
-- 2. CrmQuote: invoices beside quotes (kind, numbered per kind), tax, and
--    what the public accept page records: the typed name and time (already
--    there), a hash of the IP, a decline with its reason, when it was paid
--    and the Finance transaction that booked it.

-- AlterTable
ALTER TABLE "CrmSettings" ADD COLUMN "phone" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "CrmQuote" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'quote',
ADD COLUMN "taxBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "acceptedIpHash" TEXT,
ADD COLUMN "declinedAt" TIMESTAMP(3),
ADD COLUMN "declineReason" TEXT,
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "financeTransactionId" TEXT;

ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_kind_check" CHECK ("kind" IN ('quote', 'invoice'));
ALTER TABLE "CrmQuote" ADD CONSTRAINT "CrmQuote_taxBps_check" CHECK ("taxBps" >= 0 AND "taxBps" <= 10000);
