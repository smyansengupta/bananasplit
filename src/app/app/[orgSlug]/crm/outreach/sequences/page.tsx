import { redirect } from "next/navigation";

/** Sequences are plans on Outreach now; old links land there. */
export default async function SequencesPage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/sequences">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/crm/outreach`);
}
