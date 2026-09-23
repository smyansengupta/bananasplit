import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";

/**
 * Settings > General (stub). Shows the org's current name, URL and timezone;
 * the Settings builder adds editing (name, slug rename, logo, timezone).
 */
export default async function GeneralSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/general">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "settings.view")) {
    return <SettingsNoAccess title="General" who="owners and admins" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">General</h1>
      <dl className="grid gap-4 rounded-lg border p-4 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-muted-foreground">Name</dt>
        <dd className="font-medium">{organization.name}</dd>
        <dt className="text-muted-foreground">URL</dt>
        <dd className="font-mono text-xs">/app/{organization.slug}</dd>
        <dt className="text-muted-foreground">Timezone</dt>
        <dd>{organization.timezone}</dd>
      </dl>
      <EmptyState
        icon={Building2}
        title="Editing is coming soon"
        description="Renaming the org, changing its URL, the logo and the timezone will be managed here."
      />
    </div>
  );
}
