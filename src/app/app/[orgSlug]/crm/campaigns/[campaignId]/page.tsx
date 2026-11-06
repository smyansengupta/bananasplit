import { redirect } from "next/navigation";

import { crmPlanHref } from "@/lib/crm/href";

/** A campaign opens as its card over CRM settings > Automations (?open=plan:campaign:<id>). */
export default async function CampaignPage({ params }: PageProps<"/app/[orgSlug]/crm/campaigns/[campaignId]">) {
  const { orgSlug, campaignId } = await params;
  redirect(crmPlanHref(orgSlug, "campaign", campaignId));
}
