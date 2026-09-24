import { SettingsNoAccess } from "../../settings-no-access";
import { IntegrationHeader } from "../integration-header";
import { StatusPanel, TestAndRemove } from "../integration-ui";
import { loadIntegrationPage } from "../load";
import { SupabaseForm } from "../provider-forms";

/**
 * Settings > Integrations > Website data (Supabase): the structured
 * connection fields plus the read-only role's password (an OrgSecret), and a
 * test that runs suite_export.contract_version() on a read-only connection.
 */
export default async function DataSourceIntegrationPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/integrations/data-source">) {
  const { orgSlug } = await params;
  const page = await loadIntegrationPage(orgSlug, "SUPABASE_SOURCE");
  if (!page) return <SettingsNoAccess title="Website data" who="owners and admins" />;
  const { organization, dto, canWrite, canRemove } = page;
  const version =
    typeof dto.config.contractVersion === "string" ? dto.config.contractVersion : null;

  return (
    <div className="max-w-2xl space-y-6">
      <IntegrationHeader
        orgSlug={orgSlug}
        title="Website data (Supabase)"
        description="Check-ins, signups and ballots from your website's Supabase database, synced into the Databases and Reports sections. The portal connects with a read-only role that can only call the export functions."
      />
      <StatusPanel dto={dto} secretLabel="Password" />
      {version && (
        <p className="text-muted-foreground text-sm">Export contract version {version}.</p>
      )}
      <SupabaseForm orgId={organization.id} dto={dto} canWrite={canWrite} />
      {dto.hasSecret && (
        <TestAndRemove
          orgId={organization.id}
          provider="SUPABASE_SOURCE"
          canTest={canWrite}
          canRemove={canRemove}
          removeCopy="The password is deleted and syncing stops. Data already synced stays."
        />
      )}
      <details className="text-muted-foreground text-sm">
        <summary className="cursor-pointer">How to set up the read-only role</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
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
      </details>
    </div>
  );
}
