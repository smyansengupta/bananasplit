import { BrandMark } from "@/components/marketing/brand-mark";
import { readAddOns } from "@/lib/addons";
import { DATA_CONNECTOR_MARKS } from "@/lib/crm/connector-marks";
import { can } from "@/lib/auth/permissions";
import { loadDataConnections } from "@/server/crm/data-connectors";
import { getOrgContextBySlug } from "@/server/db/context";

import { DataConnectors, type ConnectorMarks } from "./data-connectors";

/**
 * Integrations and apps: the CRM's bring-your-own data connectors (Tavily,
 * Hunter, Prospeo; docs/features/crm.md differentiator 8). Shown once the
 * space (an organization or a Personal space) has added the CRM; owners
 * and admins connect, test and see the credits used this month, only
 * owners remove a key. Self-contained: the Integrations page adds it with
 * one line.
 */
export async function DataConnectorsSection({ orgSlug }: { orgSlug: string }) {
  const ctx = await getOrgContextBySlug(orgSlug);
  if (!readAddOns(ctx.settings?.addOns).includes("crm")) return null;
  if (!can({ role: ctx.role }, "integrations.view")) return null;
  const connections = await loadDataConnections(ctx.organization.id);
  return (
    <DataConnectors
      orgId={ctx.organization.id}
      canManage={can({ role: ctx.role }, "integrations.write")}
      canRemove={can({ role: ctx.role }, "integrations.remove")}
      connections={connections}
      marks={Object.fromEntries(
        (Object.keys(DATA_CONNECTOR_MARKS) as (keyof typeof DATA_CONNECTOR_MARKS)[]).map((id) => [
          id,
          { row: <BrandMark brand={DATA_CONNECTOR_MARKS[id]} size={36} />, title: <BrandMark brand={DATA_CONNECTOR_MARKS[id]} size={32} /> },
        ]),
      ) as ConnectorMarks}
    />
  );
}
