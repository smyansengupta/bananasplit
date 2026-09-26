import { appOrigin } from "@/lib/app-url";
import { can } from "@/lib/auth/permissions";
import { orgLogoUrl } from "@/lib/org-logo";
import { getOrgContextBySlug } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";
import { LogoForm, NameForm, SlugForm, TimezoneForm } from "./general-forms";

/**
 * Settings > General: name and timezone (OWNER/ADMIN), logo (OWNER/ADMIN),
 * and the URL (OWNER only; old URLs redirect and stay reserved).
 */
export default async function GeneralSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/general">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "settings.view")) {
    return <SettingsNoAccess title="General" who="owners and admins" />;
  }
  const canWrite = can({ role }, "settings.general.write");

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">General</h1>
      <NameForm orgId={organization.id} name={organization.name} canEdit={canWrite} />
      <SlugForm
        orgId={organization.id}
        slug={organization.slug}
        canEdit={can({ role }, "org.slug.write")}
        appOrigin={appOrigin()}
      />
      <LogoForm
        orgId={organization.id}
        orgName={organization.name}
        logoUrl={orgLogoUrl(organization.logo, 256)}
        canEdit={can({ role }, "org.logo.write")}
      />
      <TimezoneForm orgId={organization.id} timezone={organization.timezone} canEdit={canWrite} />
    </div>
  );
}
