import { notFound, redirect } from "next/navigation";

import { crmAutomationHref } from "@/lib/crm/href";
import { bookingLinksHref, findSection } from "@/lib/crm/settings-sections";

export const metadata = { title: "CRM settings" };

/**
 * Nothing lives under a CRM settings section any more: an old automation
 * link (/crm/settings/automations/{id}, or new, with ?describe=) opens it
 * over Automations and sending, and a booking page's old address
 * (/crm/settings/booking/{id}) opens it in Meetings > Meeting links.
 */
export default async function CrmSettingsItemPage({
  params,
  searchParams,
}: PageProps<"/app/[orgSlug]/crm/settings/[section]/[id]">) {
  const { orgSlug, section, id } = await params;
  if (section === "booking") redirect(bookingLinksHref(orgSlug, id));
  if (findSection(section)?.id !== "automations") notFound();
  const sp = (await searchParams) as Record<string, string | undefined>;
  redirect(crmAutomationHref(orgSlug, id, sp.describe));
}
