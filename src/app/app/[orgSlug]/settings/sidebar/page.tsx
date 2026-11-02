import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { resolveSidebar } from "@/lib/nav/sidebar";
import { getOrgContextBySlug } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

import { SettingsNoAccess } from "../settings-no-access";
import { SidebarEditor } from "./sidebar-editor";

/**
 * Admin panel › Sidebar (OWNER/ADMIN): the sections the club uses, their
 * order and names, for everyone in the organization.
 */
export default async function SidebarSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/sidebar">) {
  const { orgSlug } = await params;
  const planLock = await planGate(orgSlug, "sidebar");
  if (planLock) return planLock;
  const { organization, role, settings } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "settings.view")) {
    return <SettingsNoAccess title="Sidebar" who="owners and admins" />;
  }
  // Add-ons the organization hasn't added aren't there to arrange.
  const groups = resolveSidebar(settings?.sidebar, settings?.addOns ?? []).map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.notAdded),
  }));
  const customized = settings?.sidebar != null;

  return (
    <div className="space-y-7.5">
      <PageHeader title="Sidebar" />
      <SidebarEditor
        orgId={organization.id}
        initial={groups}
        customized={customized}
        canEdit={can({ role }, "settings.general.write")}
      />
    </div>
  );
}
