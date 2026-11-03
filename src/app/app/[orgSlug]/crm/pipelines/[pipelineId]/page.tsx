import { notFound } from "next/navigation";

import { CrmTabs } from "@/components/crm/crm-tabs";
import { PipelineView, type CardView } from "@/components/crm/pipeline-view";
import type { EditField } from "@/lib/crm/record-form";
import { customFieldsFor } from "@/server/crm/databases";
import { ownerLabel } from "@/server/crm/owners";
import { daysInStage, DEAL_SORT_LABELS, isStuck, listDeals, parseDealQuery } from "@/server/crm/queries";
import { withOrgTx } from "@/server/db/context";

import { crmShell } from "../../shell";

export const metadata = { title: "Pipeline" };

/** One pipeline as a board (drag between stages) or a table. */
export default async function CrmPipelinePage({ params, searchParams }: PageProps<"/app/[orgSlug]/crm/pipelines/[pipelineId]">) {
  const { orgSlug, pipelineId } = await params;
  const sp = (await searchParams) as Record<string, string | string[] | undefined>;
  const { gate, shell } = await crmShell(orgSlug);
  if (!shell) return gate;
  const pipeline = shell.pipelines.find((p) => p.id === pipelineId);
  if (!pipeline) notFound();
  const query = parseDealQuery(sp);
  const limits = new Map(pipeline.stages.map((s) => [s.id, s.stuckAfterDays] as const));
  const now = new Date();
  const { deals, fields } = await withOrgTx(shell.org.id, async ({ db }) => ({
    deals: await listDeals(db, shell.org.id, pipeline.id, query, shell.user.id, shell.roles, limits, now),
    fields: await customFieldsFor(db, shell.org.id, "deal", pipeline.id),
  }));
  const names = new Map(shell.members.map((m) => [m.id, m.name]));
  const cards: CardView[] = deals.map((d) => ({
    id: d.id,
    title: d.title,
    stageId: d.stageId,
    amountCents: d.amountCents,
    currency: d.currency,
    companyName: d.companyName,
    personName: d.personName,
    nextStep: d.nextStep,
    expectedOn: d.expectedOn?.toISOString() ?? null,
    owner: ownerLabel(d, shell.roles, names),
    days: daysInStage(d, now),
    stuck: isStuck(d, limits.get(d.stageId) ?? null, now),
    closed: d.closedAt !== null,
    sponsorship: Boolean(d.sponsorshipId),
  }));
  const ownerOptions = [
    ...shell.members.map((m) => ({ value: `u:${m.id}`, label: m.name })),
    ...[...shell.roles.values()].map((r) => ({ value: `r:${r.key}`, label: r.title })),
  ];
  const stageFields: EditField[] = [
    { key: "amount", label: "Amount", kind: "CURRENCY", value: null },
    { key: "nextStep", label: "Next step", kind: "TEXT", value: null },
    { key: "nextStepAt", label: "Next step by", kind: "DATE", value: null },
    { key: "expectedOn", label: "Expected", kind: "DATE", value: null },
    { key: "company", label: "Company", kind: "COMPANY", value: null },
    { key: "person", label: "Person", kind: "PERSON", value: null },
    { key: "owner", label: "Owner", kind: "OWNER", value: null, options: ownerOptions },
    { key: "closeReason", label: "Reason", kind: "LONG_TEXT", value: null },
    ...fields.map((f) => ({ key: `custom.${f.id}`, label: f.name, kind: "CUSTOM" as const, value: null, field: f })),
  ];
  return (
    <PipelineView
      orgId={shell.org.id}
      orgSlug={orgSlug}
      pipeline={pipeline}
      stages={pipeline.stages.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        stuckAfterDays: s.stuckAfterDays,
        requiredFields: s.requiredFields,
      }))}
      cards={cards}
      members={shell.members}
      sortLabels={DEAL_SORT_LABELS}
      stageFields={stageFields}
      tabs={<CrmTabs tabs={shell.tabs} />}
    />
  );
}
