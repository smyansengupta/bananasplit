import { SettingsNoAccess } from "../../settings-no-access";
import { IntegrationHeader } from "../integration-header";
import { StatusPanel, TestAndRemove } from "../integration-ui";
import { loadIntegrationPage } from "../load";
import { NetlifyForm } from "../provider-forms";

/**
 * Settings > Integrations > Website build hook (Netlify). The hook URL is a
 * secret (anyone holding it can start builds) and must match
 * https://api.netlify.com/build_hooks/<id>.
 */
export default async function WebsiteIntegrationPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/integrations/website">) {
  const { orgSlug } = await params;
  const page = await loadIntegrationPage(orgSlug, "NETLIFY_BUILD_HOOK");
  if (!page) return <SettingsNoAccess title="Website build hook" who="owners and admins" />;
  const { organization, dto, canWrite, canRemove } = page;

  return (
    <div className="max-w-2xl space-y-6">
      <IntegrationHeader
        orgSlug={orgSlug}
        title="Website build hook"
        description="When public events change, the portal asks Netlify to rebuild your website so it shows the new schedule (at most once a minute)."
      />
      <StatusPanel dto={dto} secretLabel="Hook" />
      <NetlifyForm orgId={organization.id} dto={dto} canWrite={canWrite} />
      {dto.hasSecret && (
        <TestAndRemove
          orgId={organization.id}
          provider="NETLIFY_BUILD_HOOK"
          canTest={canWrite}
          canRemove={canRemove}
          testLabel="Trigger a test build"
          removeCopy="The hook is deleted. Your website stops rebuilding automatically when events change."
        />
      )}
    </div>
  );
}
