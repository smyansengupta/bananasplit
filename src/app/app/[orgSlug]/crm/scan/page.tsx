import { CardScan } from "@/components/crm/ai/card-scan";
import { CrmTabs } from "@/components/crm/crm-tabs";
import { PageHeader } from "@/components/page-header";

import { crmShell } from "../shell";

export const metadata = { title: "Scan a card" };

/** Business cards and badges at events, from a phone: a photo becomes a person to review. */
export default async function CrmScanPage({ params }: PageProps<"/app/[orgSlug]/crm/scan">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  return (
    <div className="space-y-6">
      <PageHeader title="Scan a card" description="A photo of a business card or badge becomes a person, waiting in Review." tabs={<CrmTabs tabs={shell.tabs} />} />
      <CardScan orgId={shell.org.id} orgSlug={orgSlug} />
    </div>
  );
}
