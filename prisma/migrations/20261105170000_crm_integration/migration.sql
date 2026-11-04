-- The CRM's phases, wired together (docs/features/crm.md, "Integration as
-- built"). Columns only: no table, policy, grant or function changes, so
-- app.security_manifest() is unchanged.
--
-- CrmEmailMessage.workflowId: mail a workflow step sent through outreach's
--   one send path; it counts toward the sender's daily cap and carries the
--   unsubscribe footer, like sequence mail.
-- CrmEmailMessage.personId: who a message is for, so an unsent DRAFT (an AI
--   draft waiting in compose, which has no timeline row yet) is found on
--   the person's page.

-- AlterTable
ALTER TABLE "CrmEmailMessage" ADD COLUMN     "personId" TEXT,
ADD COLUMN     "workflowId" TEXT;

-- CreateIndex
CREATE INDEX "CrmEmailMessage_organizationId_personId_status_idx" ON "CrmEmailMessage"("organizationId", "personId", "status");
