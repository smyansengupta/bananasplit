import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/auth/permissions";
import { resolveSidebar } from "@/lib/nav/sidebar";
import { getOrgContextBySlug } from "@/server/db/context";
import { planGate } from "@/server/billing/plan-gate";

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
  const planLock = await planGate(orgSlug, "sidebar");
  if (planLock) return planLock;
  const { organization, role, settings } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "settings.view")) {
    return <SettingsNoAccess title="Sidebar" who="owners and admins" />;
  }
  const groups = resolveSidebar(settings?.sidebar);
  const items = groups.flatMap((g) => g.items);
  const hidden = items.filter((i) => i.hidden).length;
  const customized = settings?.sidebar != null;
  const summary = [
    `${items.length - hidden} section${items.length - hidden === 1 ? "" : "s"} shown`,
    hidden > 0 ? `${hidden} hidden` : null,
    customized ? "customized for the organization" : "the default layout",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-7.5">
      <div className="space-y-3">
        <PageHeader title="Sidebar" description={summary} />
        <p className="text-muted-foreground max-w-prose text-sm">
          Make {organization.name}&apos;s sidebar fit how your organization works: hide what you
          don&apos;t use, drag sections into the order you want or under another heading, and rename
          them. Everyone in the organization gets this sidebar.
        </p>
      </div>
      <SidebarEditor
        orgId={organization.id}
        initial={groups}
        customized={customized}
        canEdit={can({ role }, "settings.general.write")}
      />
    </div>
  );
}
