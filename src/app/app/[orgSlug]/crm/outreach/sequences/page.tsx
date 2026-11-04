import { redirect } from "next/navigation";

import { outreachRedirectHref } from "@/lib/crm/redirects";

/** Sequences are follow-up series in CRM settings > Automations now. */
export default async function SequencesPage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/sequences">) {
  const { orgSlug } = await params;
  redirect(outreachRedirectHref(orgSlug, "sequences"));
}
