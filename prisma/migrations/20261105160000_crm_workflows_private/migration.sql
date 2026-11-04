-- Workflows are for the people who shape the CRM (docs/features/crm.md,
-- module 6). A workflow's steps can hold Slack, Discord and webhook
-- addresses (secrets in all but name), and its run log says what it did to
-- whom, so CrmWorkflow and CrmWorkflowRun are now readable only by owners,
-- admins and CRM managers. Writing was already theirs alone. Jobs run as
-- app_service, so the engine, the daily triggers and the outgoing calls are
-- unaffected.
--
-- A member's change still has to know whether any workflow listens, without
-- reading CrmWorkflow: CrmSettings.workflowTriggers keeps the trigger types
-- of the switched-on workflows (rewritten whenever a workflow is saved,
-- switched or deleted; src/server/crm/workflows.ts), the same way
-- webhookEvents does for outgoing webhooks.

-- AlterTable
ALTER TABLE "CrmSettings" ADD COLUMN     "workflowTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE "CrmSettings" s
   SET "workflowTriggers" = COALESCE((
         SELECT array_agg(DISTINCT w."trigger"->>'type' ORDER BY w."trigger"->>'type')
           FROM "CrmWorkflow" w
          WHERE w."organizationId" = s."organizationId"
            AND w."status" = 'ON'
            AND w."trigger"->>'type' IS NOT NULL
       ), ARRAY[]::TEXT[]);

DROP POLICY app_user_select ON "CrmWorkflow";
CREATE POLICY app_user_select ON "CrmWorkflow" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));

DROP POLICY app_user_select ON "CrmWorkflowRun";
CREATE POLICY app_user_select ON "CrmWorkflowRun" FOR SELECT TO app_user
  USING ("organizationId" = (SELECT app.member_org_id())
         AND ((SELECT app.is_org_admin()) OR (SELECT app.is_crm_manager())));
