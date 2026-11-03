import { redirect } from "next/navigation";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { CrmSettingsLinks } from "@/components/crm/settings/settings-links";
import { Webhooks } from "@/components/crm/settings/webhooks";
import { PageHeader } from "@/components/page-header";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Webhooks" };

/** Outgoing webhooks and their delivery log (owners and admins; RLS hides both from everyone else). */
export default async function CrmWebhooksPage({ params }: PageProps<"/app/[orgSlug]/crm/settings/webhooks">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  if (!shell.access.admin) redirect(`/app/${orgSlug}/crm`);
  const orgId = shell.org.id;
  const hooks = await withOrgTx(orgId, ({ db }) =>
    db.crmWebhook.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        deliveries: {
          orderBy: { createdAt: "desc" },
          take: 15,
          select: { id: true, event: true, status: true, attempts: true, responseCode: true, lastError: true, createdAt: true },
        },
      },
    }),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Send CRM events to Zapier, Make or your own app as they happen."
        tabs={<CrmTabs tabs={shell.tabs} />}
      />
      <CrmSettingsLinks orgSlug={orgSlug} current="webhooks" />
      <Webhooks
        orgId={orgId}
        hooks={hooks.map((h) => ({
          ...h,
          deliveries: h.deliveries.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
        }))}
      />
    </div>
  );
}
