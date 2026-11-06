import { redirect } from "next/navigation";

import { outreachRedirectHref } from "@/lib/crm/redirects";

/** Split lists and group emails are listed in CRM settings > Automations now. */
export default async function CampaignsPage({ params }: PageProps<"/app/[orgSlug]/crm/campaigns">) {
  const { orgSlug } = await params;
  redirect(outreachRedirectHref(orgSlug, "campaigns"));
}
