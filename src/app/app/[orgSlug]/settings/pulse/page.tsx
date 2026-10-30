import { redirect } from "next/navigation";

/**
 * The weekly pulse's settings moved into General's Schedule card. Old links
 * and bookmarks land there.
 */
export default async function PulseSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/pulse">) {
  const { orgSlug } = await params;
  redirect(`/app/${orgSlug}/settings/general#pulse`);
}
