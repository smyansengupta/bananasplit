import { redirect } from "next/navigation";

import { profileHref } from "@/lib/profile/href";

/**
 * Notification preferences moved to the profile (Phase 2): they belong to
 * the user, not the org. Old links and bookmarks land on that section.
 */
export default async function NotificationSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/settings/notifications">) {
  const { orgSlug } = await params;
  redirect(profileHref(orgSlug, "notifications"));
}
