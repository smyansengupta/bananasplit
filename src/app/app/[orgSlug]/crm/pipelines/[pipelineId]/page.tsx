import { redirect } from "next/navigation";

import { crmPipelineHref } from "@/lib/crm/href";

/** A pipeline is a filter on Deals now (?pipeline=, as a board); old links land there. */
export default async function CrmPipelinePage({
  params,
}: PageProps<"/app/[orgSlug]/crm/pipelines/[pipelineId]">) {
  const { orgSlug, pipelineId } = await params;
  redirect(crmPipelineHref(orgSlug, pipelineId));
}
