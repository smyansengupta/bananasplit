-- Approval checked when mail leaves (docs/features/crm.md, "Nothing sends
-- unapproved"): every outgoing CRM email and text records who said it may
-- go, and the send jobs check it again just before it leaves. Anything
-- without one is turned into a draft (email) or held for the sender (text).
--
-- New columns only, on tables whose row-level policies already cover every
-- column: no policy changes, and app.security_manifest() is untouched.

ALTER TABLE "CrmEmailMessage" ADD COLUMN "approval" TEXT,
ADD COLUMN "approvedById" TEXT;

ALTER TABLE "CrmTextMessage" ADD COLUMN "approvedById" TEXT;

-- Backfill what was already approved.
-- 1. A member queued it (compose, a campaign share, bulk, Send on a draft).
UPDATE "CrmEmailMessage"
   SET "approvedById" = "createdById", "approval" = 'send'
 WHERE "direction" = 'OUTBOUND' AND "createdById" IS NOT NULL AND "status" <> 'DRAFT';

-- 2. A plan's first email, when a person pressed Start or Enroll.
UPDATE "CrmEmailMessage" m
   SET "approvedById" = e."enrolledById", "approval" = 'start'
  FROM "CrmEnrollment" e
 WHERE m."enrollmentId" = e."id" AND m."organizationId" = e."organizationId"
   AND m."direction" = 'OUTBOUND' AND m."approval" IS NULL AND m."status" <> 'DRAFT'
   AND e."enrolledById" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "CrmEmailMessage" o
      WHERE o."enrollmentId" = m."enrollmentId" AND o."organizationId" = m."organizationId"
        AND o."id" <> m."id" AND o."status" <> 'DRAFT' AND o."createdAt" < m."createdAt");

-- 3. A booking confirmation to the guest (untracked, nobody pressed Send).
UPDATE "CrmEmailMessage"
   SET "approval" = 'receipt'
 WHERE "direction" = 'OUTBOUND' AND "approval" IS NULL AND "createdById" IS NULL
   AND "enrollmentId" IS NULL AND "workflowId" IS NULL AND "campaignId" IS NULL
   AND "error" = 'untracked';

-- Texts that already went. A text still waiting keeps no approval: the
-- send job holds it and tells the sender, who sends it from the card.
UPDATE "CrmTextMessage"
   SET "approvedById" = "userId"
 WHERE "direction" = 'OUTBOUND' AND "userId" IS NOT NULL AND "status" NOT IN ('queued', 'scheduled');
