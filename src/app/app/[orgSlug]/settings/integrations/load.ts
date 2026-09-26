import type { IntegrationProvider } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/permissions";
import { getOrgContextBySlug } from "@/server/db/context";
import type { IntegrationDto } from "@/server/integrations/catalog";
import { loadIntegrations } from "@/server/integrations/service";

/** What an integration sub-page needs: the org, the viewer's rights and the DTO (never a secret). */
export async function loadIntegrationPage(orgSlug: string, provider: IntegrationProvider) {
  const { organization, role } = await getOrgContextBySlug(orgSlug);
  if (!can({ role }, "integrations.view")) return null;
  const dtos = await loadIntegrations(organization.id);
  const dto = dtos.find((d) => d.provider === provider) as IntegrationDto;
  return {
    organization,
    role,
    dto,
    canWrite: can({ role }, "integrations.write"),
    canRemove: can({ role }, "integrations.remove"),
  };
}
