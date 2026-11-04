import { redirect } from "next/navigation";

import { outreachRedirectHref } from "@/lib/crm/redirects";

/** Your mail is in CRM settings > You. */
export default async function MailPage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/mail">) {
  const { orgSlug } = await params;
  redirect(outreachRedirectHref(orgSlug, "mail"));
}
