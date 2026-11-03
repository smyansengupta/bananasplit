import { readAddOns } from "@/lib/addons";
import { can } from "@/lib/auth/permissions";
import { loadDataConnections } from "@/server/crm/data-connectors";
import { getOrgContextBySlug } from "@/server/db/context";

import { DataConnectors } from "./data-connectors";

/**
 * Integrations and apps: the CRM's bring-your-own data connectors (Tavily,
 * Hunter, Prospeo; docs/features/crm.md differentiator 8). Shown once the
 * organization has added the CRM; owners and admins connect, test and see
 * the credits used this month, only owners remove a key. Self-contained:
 * the Integrations page adds it with one line.
 */
export async function DataConnectorsSection({ orgSlug }: { orgSlug: string }) {
  const ctx = await getOrgContextBySlug(orgSlug);
  if (ctx.organization.kind === "PERSONAL" || !readAddOns(ctx.settings?.addOns).includes("crm")) return null;
  if (!can({ role: ctx.role }, "integrations.view")) return null;
  const connections = await loadDataConnections(ctx.organization.id);
  return (
    <DataConnectors
      orgId={ctx.organization.id}
      canManage={can({ role: ctx.role }, "integrations.write")}
      canRemove={can({ role: ctx.role }, "integrations.remove")}
      connections={connections}
    />
  );
}
