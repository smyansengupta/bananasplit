import { readOptions } from "@/lib/databases/fields";
import { crmConnectionLabel } from "@/server/crm/ai";
import { listRuns, readAgentSettings } from "@/server/crm/agents";
import { loadDataConnections } from "@/server/crm/data-connectors";
import { STEP_LABELS, waterfallOrder } from "@/server/crm/enrich";
import { usageThisMonth } from "@/server/crm/usage";
import { withOrgTx } from "@/server/db/context";

import { AiSettings } from "./ai-settings";

/**
 * CRM settings' AI section (docs/features/crm.md: usage and the hard cap,
 * the enrichment waterfall, the agents and their run log, AI fields'
 * column fills, and Bananasplit AI coming later). Self-contained: the
 * settings page adds it with one line.
 */
export async function AiSettingsSection({
  orgId,
  orgSlug,
  admin,
  showCap = true,
}: {
  orgId: string;
  orgSlug: string;
  admin: boolean;
  /** Off in CRM settings > AI, where the organization's keys card has the cap. */
  showCap?: boolean;
}) {
  const [data, connection, connectors] = await Promise.all([
    withOrgTx(orgId, async ({ db }) => {
      const usage = await usageThisMonth(db, orgId);
      const settings = await db.crmSettings.findUnique({ where: { organizationId: orgId }, select: { enrichmentOrder: true } });
      const agents = await readAgentSettings(db, orgId);
      const runs = await listRuns(db, orgId, 10);
      const fields = await db.databaseField.findMany({
        where: { organizationId: orgId, type: "AI", database: { kind: { in: ["CRM_PEOPLE", "CRM_COMPANIES", "CRM_PIPELINE"] } } },
        select: { id: true, name: true, options: true, database: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      return { usage, order: settings?.enrichmentOrder ?? [], agents, runs, fields };
    }),
    crmConnectionLabel(orgId),
    loadDataConnections(orgId),
  ]);
  const connected = new Set(connectors.filter((c) => c.connected || c.attention).map((c) => c.id));
  const order = waterfallOrder(data.order).map((step) => ({
    step,
    label: STEP_LABELS[step],
    available: step === "claude" ? connection?.id === "claude" || connection?.id === "platform" : connected.has(step),
  }));
  return (
    <AiSettings
      orgId={orgId}
      orgSlug={orgSlug}
      admin={admin}
      showCap={showCap}
      connection={connection?.label ?? null}
      usage={{
        total: data.usage.totalMicros,
        platform: data.usage.platformMicros,
        calls: data.usage.calls,
        lookups: data.usage.lookups,
        byFeature: data.usage.byFeature,
        byMember: data.usage.byMember,
        capCents: data.usage.capCents,
        month: new Date(data.usage.monthStart).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
      }}
      order={order}
      agents={{ researchNew: data.agents.researchNew, followUp: data.agents.followUp, followUpDays: data.agents.followUpDays }}
      runs={data.runs.map((r) => ({ ...r, target: r.target ? { name: r.target.name, kind: r.target.kind, id: r.target.id } : null }))}
      fields={data.fields.map((f) => {
        const o = readOptions(f.options);
        return { id: f.id, name: f.name, database: f.database.name, auto: o.auto ?? "off", research: o.research === true, hasPrompt: Boolean(o.prompt?.trim()) };
      })}
    />
  );
}
