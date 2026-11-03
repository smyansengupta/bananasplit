-- CRM settings: the Sending section's window and unsubscribe line, and
-- how much the CRM may do alone (Automations). Both live on CrmSettings,
-- so its existing row-level policies and grants cover them.
ALTER TABLE "CrmSettings" ADD COLUMN     "autonomy" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sending" JSONB NOT NULL DEFAULT '{}';
