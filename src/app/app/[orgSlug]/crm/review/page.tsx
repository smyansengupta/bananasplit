import { redirect } from "next/navigation";

/**
 * Duplicates live on People now: the "Look like duplicates" list, where
 * each row's Merge opens the Merge card (?open=merge:<a>,<b>). Today shows
 * them under To approve too.
 */
export default async function CrmReviewPage({ params }: PageProps<"/app/[orgSlug]/crm/review">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/crm/people?list=dupes`);
}
