import { redirect } from "next/navigation";

import { crmSettingsHref, defaultSection } from "@/lib/crm/settings-sections";

import { crmShell } from "../shell";

export const metadata = { title: "CRM settings" };

/**
 * CRM settings opens on a section: Automations for whoever runs the CRM
 * (owners, admins, CRM managers), You for everyone else.
 */
export default async function CrmSettingsPage({
  params,
}: PageProps<"/app/[orgSlug]/crm/settings">) {
  const { orgSlug } = await params;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  redirect(
    crmSettingsHref(
      orgSlug,
      defaultSection({
        admin: shell.access.admin,
        manager: shell.access.manager,
        personal: shell.access.personal,
      }),
    ),
  );
}
