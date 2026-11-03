import { QUEUE_KINDS } from "@/lib/crm/suggestions";
import { crmConnectionLabel } from "@/server/crm/ai";
import { builtinField } from "@/lib/crm/fields";
import { customFieldsFor } from "@/server/crm/databases";
import { fieldSources, readEnrichment, summaryOf } from "@/server/crm/enrichment-store";
import { withOrgTx } from "@/server/db/context";

import { RecordAiPanel } from "./record-ai-panel";

/**
 * "Where we stand" at the top of a person, company or item, with the
 * record's AI actions: draft a follow-up, a meeting brief, meeting or call
 * notes, a pasted conversation, enrichment and research. Self-contained, so
 * a record page adds it with one line. The summary is the one kept on the
 * record (enrichment._summary); nothing runs until someone asks.
 */
export async function RecordAi({
  orgId,
  orgSlug,
  kind,
  id,
  name,
  readOnly = false,
}: {
  orgId: string;
  orgSlug: string;
  kind: "person" | "company" | "deal";
  id: string;
  name: string;
  readOnly?: boolean;
}) {
  const [data, connection] = await Promise.all([
    withOrgTx(orgId, async ({ db }) => {
      const enrichment = await readEnrichment(db, orgId, { kind, id });
      const waiting = await db.crmSuggestion.count({
        where: { organizationId: orgId, status: "PENDING", kind: { in: [...QUEUE_KINDS] }, targetKind: kind, targetId: id },
      });
      const email =
        kind === "person"
          ? ((await db.crmPerson.findFirst({ where: { id, organizationId: orgId }, select: { primaryEmail: true } }))?.primaryEmail ?? null)
          : null;
      const fields = await customFieldsFor(db, orgId, kind, kind === "deal" ? ((await db.crmDeal.findFirst({ where: { id, organizationId: orgId }, select: { pipelineId: true } }))?.pipelineId ?? null) : null);
      const names = new Map(fields.map((f) => [f.id, f.name]));
      const sources = Object.entries(fieldSources(enrichment))
        .map(([key, e]) => ({
          label: key.startsWith("custom.") ? (names.get(key.slice(7)) ?? null) : key === "companyName" ? "Company" : (builtinField(kind, key)?.label ?? null),
          from: e.citations?.[0]?.label ?? e.label ?? e.source,
          url: e.citations?.find((c) => c.url)?.url ?? e.url ?? null,
          at: e.at,
          via: e.source,
        }))
        .filter((x): x is { label: string; from: string; url: string | null; at: string; via: string } => Boolean(x.label))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 20);
      return { summary: summaryOf(enrichment), waiting, email, sources };
    }),
    crmConnectionLabel(orgId),
  ]);
  return (
    <RecordAiPanel
      orgId={orgId}
      orgSlug={orgSlug}
      kind={kind}
      id={id}
      name={name}
      email={data.email}
      readOnly={readOnly}
      summary={data.summary ? { text: data.summary.text, points: data.summary.points, at: data.summary.at } : null}
      waiting={data.waiting}
      sources={data.sources}
      connection={connection?.label ?? null}
    />
  );
}
