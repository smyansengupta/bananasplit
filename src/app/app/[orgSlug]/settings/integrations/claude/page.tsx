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
        description="Your organization's own Claude key. The org chart importer reads uploaded documents with it; usage is billed to your Anthropic account."
      />
      <StatusPanel dto={dto} secretLabel="API key" />
      <ClaudeForm orgId={organization.id} dto={dto} canWrite={canWrite} />
      {dto.hasSecret && (
        <TestAndRemove
          orgId={organization.id}
          provider="CLAUDE"
          canTest={canWrite}
          canRemove={canRemove}
          removeCopy="The key is deleted. Org chart imports stop until a new key is added."
        />
      )}
    </div>
  );
}
