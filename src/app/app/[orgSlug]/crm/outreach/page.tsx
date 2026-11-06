import { redirect } from "next/navigation";

import { outreachRedirectHref } from "@/lib/crm/redirects";

/**
 * Outreach isn't a tab any more (docs/features/crm.md, "One list"). A plan
 * card with an id opens over CRM settings > Automations, where follow-up
 * series live; one email to many opens over People; Templates and Your
 * mail are Settings sections; everything else lands on People.
 */
export default async function OutreachPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/outreach">) {
  const { orgSlug } = await params;
  redirect(
    outreachRedirectHref(orgSlug, "outreach", (await searchParams) as Record<string, string | string[] | undefined>),
  );
}
