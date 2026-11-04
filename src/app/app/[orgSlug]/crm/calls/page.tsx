import { redirect } from "next/navigation";

import { crmCallsHref } from "@/lib/crm/href";

/**
 * Calls are a group on Today now (docs/features/crm.md, "Redesign"): the
 * calls a sequence left you, each with Call and Done. Old links (a call
 * step's Inbox line) land there.
 */
export default async function CrmCallsPage({ params }: PageProps<"/app/[orgSlug]/crm/calls">) {
  const { orgSlug } = await params;
  redirect(crmCallsHref(orgSlug));
}
