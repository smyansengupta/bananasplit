import { redirect } from "next/navigation";

import { crmAutomationHref } from "@/lib/crm/href";

/** One automation now opens over CRM settings; ?describe= comes along. */
export default async function CrmWorkflowPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/automations/[workflowId]">) {
  const { orgSlug, workflowId } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  redirect(crmAutomationHref(orgSlug, workflowId, sp.describe));
}
