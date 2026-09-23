import { redirect } from "next/navigation";

import { profileHref } from "@/lib/profile/href";

/**
 * The personal calendar feed card moved to the profile (Phase 2). Old links
 * and bookmarks land on that section.
 */
export default async function CalendarSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/calendar">) {
  const { orgSlug } = await params;
  redirect(profileHref(orgSlug, "calendar"));
}
