import { getOrgContextBySlug } from "@/server/db/context";

import { settingsNavItems } from "./settings-nav";
import { SettingsSubnav } from "./settings-subnav";

/**
 * The Settings shell: a sub-navigation over every settings page, filtered by
 * the viewer's role (General, Members, Integrations, Privacy, Theme,
 * Notifications, Calendar feed, Labels, Danger zone). Each page still checks
 * its own permission on the server.
 */
export default async function SettingsLayout({
  params,
  children,
}: LayoutProps<"/app/[orgSlug]/settings">) {
  const { orgSlug } = await params;
  const { role } = await getOrgContextBySlug(orgSlug);

  return (
    <div className="space-y-6">
      <SettingsSubnav items={settingsNavItems(orgSlug, role)} />
      {children}
    </div>
  );
}
