import type { CrmShell } from "@/app/app/[orgSlug]/crm/shell";
import { crmStartedProgress } from "@/lib/crm/started";
import { loadCrmStarted } from "@/server/crm/started";

import { CrmStarted } from "./crm-started";

/**
 * "Get your CRM started" on Today: reads where this viewer stands and draws
 * the panel, or nothing once every step is done or checked off.
 */
export async function CrmStartedSection({ shell, orgSlug }: { shell: CrmShell; orgSlug: string }) {
  const viewer = { admin: shell.access.admin, personal: shell.access.personal };
  const data = await loadCrmStarted({
    organizationId: shell.org.id,
    userId: shell.user.id,
    access: shell.access,
  });
  if (crmStartedProgress(viewer, data.state, data.skipped, data.without).complete) return null;
  return (
    <div className="mb-6">
      <CrmStarted
        orgId={shell.org.id}
        orgSlug={orgSlug}
        viewer={viewer}
        state={data.state}
        skipped={data.skipped}
        without={data.without}
        counts={data.counts}
        inbound={data.inbound}
      />
    </div>
  );
}
