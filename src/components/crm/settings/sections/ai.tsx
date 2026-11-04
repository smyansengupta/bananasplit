import { AiSettingsSection } from "@/components/crm/ai/ai-settings-section";
import { OrgKeys } from "@/components/crm/settings/org-keys";
import { can } from "@/lib/auth/permissions";
import { loadOrgKeys } from "@/server/crm/org-keys";
import { resolveActor } from "@/server/integrations/service";

import type { SectionProps } from "./types";

/**
 * AI (docs/features/crm.md, "Whose keys pay for what"): the organization's
 * own keys for everything that costs per use (AI, research and lookups,
 * calls and texts, bulk email) with the monthly cap, for owners and
 * admins; then this month's use, enrichment, the agents and AI fields.
 * The data connectors (Tavily, Hunter, Prospeo) are the keys under
 * Research and lookups.
 */
export async function AiSection({ shell, orgSlug }: SectionProps) {
  const orgId = shell.org.id;
  const actor = await resolveActor(orgId);
  const keys = can(actor, "integrations.view") ? await loadOrgKeys(orgId, actor) : null;
  return (
    <>
      {keys && <OrgKeys orgId={orgId} view={keys} showCap />}
      <AiSettingsSection
        orgId={orgId}
        orgSlug={orgSlug}
        admin={shell.access.admin}
        showCap={!keys}
      />
    </>
  );
}
