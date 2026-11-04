import { redirect } from "next/navigation";

import { crmDealsHref } from "@/lib/crm/href";

/**
 * Quotes live on their deals now (docs/features/crm.md, "Deals"): a deal's
 * card has a Quote tab, and a quote with no deal opens as its own card
 * (?open=quote:<id>). The old list goes to People's board.
 */
export default async function CrmQuotesPage({ params }: PageProps<"/app/[orgSlug]/crm/quotes">) {
  const { orgSlug } = await params;
  redirect(crmDealsHref(orgSlug));
}
