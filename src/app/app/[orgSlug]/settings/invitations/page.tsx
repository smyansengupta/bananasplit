import { redirect } from "next/navigation";

/** Invitations now live on the Members page (Settings > Members). */
export default async function InvitationsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/invitations">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/settings/members`);
}
