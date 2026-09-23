import { Palette } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";

/** Settings > Theme (stub). The Themes builder (Phase 8) replaces this page. */
export default async function ThemeSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/theme">) {
  const { orgSlug } = await params;
  const { role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "theme.write")) {
    return <SettingsNoAccess title="Theme" who="owners and admins" />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Theme</h1>
      <EmptyState
        icon={Palette}
        title="Themes are coming soon"
        description="Choose the org's colors, logo and default light or dark mode, with a contrast check."
      />
    </div>
  );
}
