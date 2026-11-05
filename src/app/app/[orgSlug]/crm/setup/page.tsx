import { redirect } from "next/navigation";

/**
 * Setup is the "Get your CRM started" panel on Today now. An old link lands
 * there; bringing more people in later is in CRM settings > Connections.
 */
export default async function CrmSetupPage({ params }: PageProps<"/app/[orgSlug]/crm/setup">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/crm`);
}
