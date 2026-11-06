import { redirect } from "next/navigation";

import { queueRedirect } from "@/lib/crm/redirects";

/**
 * Review is part of Today now: suggestions, drafts and duplicates wait
 * under To approve (?show=approve). Old links land there.
 */
export default async function CrmQueuePage({ params }: PageProps<"/app/[orgSlug]/crm/queue">) {
  const { orgSlug } = await params;
  redirect(queueRedirect(orgSlug));
}
