import type { CrmShell } from "@/app/app/[orgSlug]/crm/shell";
import { loadCrmStarted } from "@/server/crm/started";

import { CrmStarted } from "./crm-started";

/**
 * "Get your CRM started" on Today: reads where this viewer stands and hands it
 * to the strip, which draws nothing once every step is done or checked off.
 * The strip stays mounted through that, so it can say so and leave by itself.
 */
export async function CrmStartedSection({ shell, orgSlug }: { shell: CrmShell; orgSlug: string }) {
  const data = await loadCrmStarted({
    organizationId: shell.org.id,
    userId: shell.user.id,
    access: shell.access,
  });
  return (
    <CrmStarted
      orgId={shell.org.id}
      orgSlug={orgSlug}
      viewer={{ admin: shell.access.admin, personal: shell.access.personal }}
      {...data}
    />
  );
}
