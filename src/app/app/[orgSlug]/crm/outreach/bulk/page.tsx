import { redirect } from "next/navigation";

/**
 * One email to a list is a plan now: it opens over Outreach (New plan has it
 * too). People's "Email them" sends ?list=, which the plan card starts from.
 */
export default async function BulkPage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/outreach/bulk">) {
  const { orgSlug } = await params;
  const { list } = (await searchParams) as Record<string, string | string[] | undefined>;
  const keep = typeof list === "string" ? `&list=${encodeURIComponent(list)}` : "";
  redirect(`/app/${orgSlug}/crm/outreach?open=plan:email${keep}`);
}
