import { redirect } from "next/navigation";

/** Polls are part of Forms now: old links and pins land there. */
export default async function PollsListPage({
  params,
}: PageProps<"/app/[orgSlug]/calendar/polls">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/forms`);
}
