import { redirect } from "next/navigation";

/**
 * Connection status folded into Integrations: each tile shows whether it
 * works, and its page tests, reconnects or removes it.
 */
export default async function SetupStatusPage({
  params,
}: PageProps<"/app/[orgSlug]/setup/status">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/integrations`);
}
