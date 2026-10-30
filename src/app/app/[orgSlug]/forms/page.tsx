import { redirect } from "next/navigation";

/**
 * Forms: until the form builder lands, its sidebar entry opens the polls
 * that Forms replaces.
 */
export default async function FormsPage({ params }: PageProps<"/app/[orgSlug]/forms">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/calendar/polls`);
}
