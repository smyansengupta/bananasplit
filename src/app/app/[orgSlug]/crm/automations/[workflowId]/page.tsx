import { redirect } from "next/navigation";

/** One automation now opens under CRM settings; ?describe= comes along. */
export default async function CrmWorkflowPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/automations/[workflowId]">) {
  const { orgSlug, workflowId } = await params;
  const sp = (await searchParams) as Record<string, string | undefined>;
  const describe = sp.describe ? `?describe=${encodeURIComponent(sp.describe)}` : "";
  redirect(`/app/${orgSlug}/crm/settings/automations/${encodeURIComponent(workflowId)}${describe}`);
}
