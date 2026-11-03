import { redirect } from "next/navigation";

/** Campaigns are plans on Outreach now; old links land there. */
export default async function CampaignsPage({ params }: PageProps<"/app/[orgSlug]/crm/campaigns">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/crm/outreach`);
}
