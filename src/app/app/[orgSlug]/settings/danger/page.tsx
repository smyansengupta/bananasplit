import { TriangleAlert } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";

/** Settings > Danger zone (stub): export all data, delete the org. OWNER only. */
export default async function DangerZonePage({
  params,
}: PageProps<"/app/[orgSlug]/settings/danger">) {
  const { orgSlug } = await params;
  const { role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "org.delete")) {
    return <SettingsNoAccess title="Danger zone" who="owners" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Danger zone</h1>
      <EmptyState
        icon={TriangleAlert}
        title="Export and delete are coming soon"
        description="Owners will be able to export all of the org's data and schedule the org for deletion, with a 30-day grace period."
      />
    </div>
  );
}
