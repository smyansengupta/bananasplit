import { can } from "@/lib/auth/permissions";
import { resolveSidebar } from "@/lib/nav/sidebar";
import { getOrgContextBySlug } from "@/server/db/context";

import { SettingsNoAccess } from "../settings-no-access";
import { SidebarEditor } from "./sidebar-editor";

/**
 * Settings › Sidebar (OWNER/ADMIN): the sections the club uses, their order,
 * their headings and names, for everyone in the org.
 */
export default async function SidebarSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/sidebar">) {
  const { orgSlug } = await params;
  const { organization, role, settings } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "settings.view")) {
    return <SettingsNoAccess title="Sidebar" who="owners and admins" />;
  }
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="page-title">Sidebar</h1>
        <p className="text-muted-foreground max-w-prose text-sm">
          Make {organization.name}&apos;s sidebar fit how your club works: hide what you don&apos;t
          use, drag sections into the order you want or under another heading, and rename them.
          Everyone in the club gets this sidebar.
        </p>
      </div>
      <SidebarEditor
        orgId={organization.id}
        initial={resolveSidebar(settings?.sidebar)}
        customized={settings?.sidebar != null}
        canEdit={can({ role }, "settings.general.write")}
      />
    </div>
  );
}
