import { redirect } from "next/navigation";

import { getOrgContextBySlug } from "@/server/db/context";

import { visibleSettingsSections } from "./settings-nav";

/**
 * The Admin panel opens on its first page: General for owners and admins,
 * Members for everyone else. There's no overview page; the old tiles only
 * repeated the list beside every page.
 */
export default async function SettingsPage({ params }: PageProps<"/app/[orgSlug]/settings">) {
  const { orgSlug } = await params;
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  const first = visibleSettingsSections(role, organization)[0];
  redirect(`/app/${orgSlug}/settings/${first?.segment ?? "members"}`);
}
