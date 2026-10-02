import { getOrgContextBySlug } from "@/server/db/context";

import { settingsNavItems } from "./settings-nav";
import { SettingsSubnav } from "./settings-subnav";

/**
 * The Settings shell: a grouped rail of every settings page the viewer's
 * role may open, beside the page (a chip strip on a phone). Each page still
 * checks its own permission on the server.
 */
export default async function SettingsLayout({
  params,
  children,
}: LayoutProps<"/app/[orgSlug]/settings">) {
  const { orgSlug } = await params;
  const { role } = await getOrgContextBySlug(orgSlug);

  return (
    <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <SettingsSubnav items={settingsNavItems(orgSlug, role)} orgSlug={orgSlug} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
