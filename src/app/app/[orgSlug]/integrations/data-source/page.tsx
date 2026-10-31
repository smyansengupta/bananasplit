import { SettingsNoAccess } from "../../settings/settings-no-access";
import { IntegrationHeader, SetupHelp } from "../integration-header";
import { StatusPanel, TestAndRemove } from "../integration-ui";
import { loadIntegrationPage } from "../load";
import { SupabaseForm } from "../provider-forms";
import { planGate } from "@/server/billing/plan-gate";

/**
 * Settings > Integrations > Website data (Supabase): the structured
 * connection fields plus the read-only role's password (an OrgSecret), and a
 * test that runs suite_export.contract_version() on a read-only connection.
 */
export default async function DataSourceIntegrationPage({
  params,
}: PageProps<"/app/[orgSlug]/integrations/data-source">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "integrations");
  if (planLock) return planLock;
  const page = await loadIntegrationPage(orgSlug, "SUPABASE_SOURCE");
  if (!page) return <SettingsNoAccess title="Website data" who="owners and admins" />;
  const { organization, dto, canWrite, canRemove } = page;
  const version =
    typeof dto.config.contractVersion === "string" ? dto.config.contractVersion : null;

  return (
    <div className="max-w-3xl space-y-7.5">
      <IntegrationHeader
        orgSlug={orgSlug}
        title="Website data (Supabase)"
        dto={dto}
        secretLabel="password"
        description={`Check-ins, signups and ballots from your website's Supabase database, synced into the Databases and Reports sections. Bananasplit connects with a read-only role that can only call the export functions.${version ? ` Export contract version ${version}.` : ""}`}
      />
      <div className="space-y-4.5">
        <StatusPanel dto={dto} secretLabel="Password" />
        <SupabaseForm orgId={organization.id} dto={dto} canWrite={canWrite} />
        {dto.hasSecret && (
          <TestAndRemove
            orgId={organization.id}
            provider="SUPABASE_SOURCE"
            name="the website data connection"
            canTest={canWrite}
            canRemove={canRemove}
            removeCopy="The password is deleted and syncing stops. Data already synced stays."
          />
        )}
        <SetupHelp title="How to set up the read-only role">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              In the website repository, run <code>supabase/suite-export.sql</code> in the Supabase
              SQL editor. It creates the <code>suite_export</code> functions and the{" "}
              <code>cbc_suite_reader</code> role, which can call only those functions.
            </li>
            <li>Set a strong password for the role (ALTER ROLE cbc_suite_reader PASSWORD …).</li>
            <li>
              Copy the project ref, and the pooler region and host prefix from Supabase &gt; Connect
              &gt; Session pooler (the host looks like aws-0-us-east-1.pooler.supabase.com).
            </li>
          </ol>
        </SetupHelp>
      </div>
    </div>
  );
}
