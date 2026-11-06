import { redirect } from "next/navigation";

import { dealsRedirectHref } from "@/lib/crm/redirects";

/**
 * Deals are People's Board view now (docs/features/crm.md, "One list"):
 * old links land there with their pipeline, stage, owner, type, show and
 * search, and a deal's card (?open=deal:<id>) still opens.
 */
export default async function CrmDealsPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/deals">) {
  const { orgSlug } = await params;
  redirect(dealsRedirectHref(orgSlug, (await searchParams) as Record<string, string | string[] | undefined>));
}
