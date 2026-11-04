import { redirect } from "next/navigation";

import { pipelineRedirect } from "@/lib/crm/redirects";

/**
 * A pipeline is a filter on Deals now (?pipeline=, as a board); old links
 * land there with their params (?open= kept, ?new=1 opens New deal).
 */
export default async function CrmPipelinePage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/pipelines/[pipelineId]">) {
  const { orgSlug, pipelineId } = await params;
  const sp = (await searchParams) as Record<string, string | string[] | undefined>;
  redirect(pipelineRedirect(orgSlug, pipelineId, sp));
}
