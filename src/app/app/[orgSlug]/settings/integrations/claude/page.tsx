import { SettingsNoAccess } from "../../settings-no-access";
import { IntegrationHeader } from "../integration-header";
import { StatusPanel, TestAndRemove } from "../integration-ui";
import { loadIntegrationPage } from "../load";
import { ClaudeForm } from "../provider-forms";

/** Settings > Integrations > Claude API: the org's own key and default model. */
export default async function ClaudeIntegrationPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/integrations/claude">) {
  const { orgSlug } = await params;
  const page = await loadIntegrationPage(orgSlug, "CLAUDE");
  if (!page) return <SettingsNoAccess title="Claude API" who="owners and admins" />;
  const { organization, dto, canWrite, canRemove } = page;

  return (
    <div className="max-w-2xl space-y-6">
      <IntegrationHeader
        orgSlug={orgSlug}
        title="Claude API"
        description="Optional. Your club's own Claude key powers the AI imports (a pasted list of action items into tasks, a calendar screenshot into events) and backs up the org chart importer for documents it can't read itself. Usage is billed to your Anthropic account."
      />
      <StatusPanel dto={dto} secretLabel="API key" />
      <ClaudeForm orgId={organization.id} dto={dto} canWrite={canWrite} />
      {dto.hasSecret && (
        <TestAndRemove
          orgId={organization.id}
          provider="CLAUDE"
          canTest={canWrite}
          canRemove={canRemove}
          removeCopy="The key is deleted. Imports keep working with the portal's own parser; documents it cannot read will need a new key."
        />
      )}
    </div>
  );
}
