import { redirect } from "next/navigation";

/** Integrations moved out of the Admin panel to their own sidebar page. */
export default async function Moved({ params }: PageProps<"/app/[orgSlug]/settings/integrations">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/integrations`);
}
