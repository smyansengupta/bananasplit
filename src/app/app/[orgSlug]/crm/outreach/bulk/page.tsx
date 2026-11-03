import { redirect } from "next/navigation";

/** One email to a list is a plan now: it opens over Outreach (New plan has it too). */
export default async function BulkPage({ params }: PageProps<"/app/[orgSlug]/crm/outreach/bulk">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/crm/outreach?open=plan:email`);
}
