import { Segmented } from "@/components/ui/segmented";
import { COMPANY_FIELDS, PERSON_FIELDS } from "@/lib/crm/fields";
import { PIPELINE_TEMPLATES, setupKindsFor } from "@/lib/crm/templates";
import type { Choice } from "@/lib/databases/fields";
import { crmDatabaseIds, requiredKeys } from "@/server/crm/databases";
import type { PipelineView } from "@/server/crm/pipelines";
import { loadFields } from "@/server/databases/custom";
import { withOrgTx } from "@/server/db/context";

import { CustomFieldsCard, RelationshipTypesCard, type FieldGroup } from "../fields-settings";
import {
  NewPipelineCard,
  PipelineCard,
  StagesCard,
  TypesCard,
  type DealTypes,
  type PipelineRow,
} from "../pipeline-settings";
import { SettingsMore } from "../settings-more";
import type { SectionProps } from "./types";

const PERSON_BUILTINS = [
  "primaryEmail",
  "phone",
  "title",
  "company",
  "relationship",
  "owner",
  "location",
];
const COMPANY_BUILTINS = ["domain", "website", "industry", "owner"];

async function loadPipeline(orgId: string, picked: PipelineView) {
  return withOrgTx(orgId, async ({ db }) => {
    const fields = picked.databaseId ? await loadFields(db, orgId, picked.databaseId) : [];
    const byStage = await db.crmDeal.groupBy({
      by: ["stageId"],
      where: { organizationId: orgId, pipelineId: picked.id, deletedAt: null },
      _count: { _all: true },
    });
    const typeField =
      fields.find((f) => f.type === "SELECT" && f.name.trim().toLowerCase() === "type") ?? null;
    const counts: Record<string, number> = {};
    if (typeField) {
      const deals = await db.crmDeal.findMany({
        where: { organizationId: orgId, pipelineId: picked.id, deletedAt: null },
        select: { custom: true },
        take: 20_000,
      });
      for (const d of deals) {
        const v = (d.custom as Record<string, unknown> | null)?.[typeField.id];
        if (typeof v === "string") counts[v] = (counts[v] ?? 0) + 1;
      }
    }
    const pipeline: PipelineRow = {
      id: picked.id,
      name: picked.name,
      itemNoun: picked.itemNoun,
      itemNounPlural: picked.itemNounPlural,
      hasAmount: picked.hasAmount,
      wonLabel: picked.wonLabel,
      lostLabel: picked.lostLabel,
      template: picked.template,
      stages: picked.stages.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        probability: s.probability,
        stuckAfterDays: s.stuckAfterDays,
        requiredFields: s.requiredFields,
        deals: byStage.find((b) => b.stageId === s.id)?._count._all ?? 0,
      })),
      fields: fields.map((f) => ({ id: f.id, name: f.name })),
      items: byStage.reduce((n, b) => n + b._count._all, 0),
    };
    const types: DealTypes = {
      fieldId: typeField?.id ?? null,
      choices: ((typeField?.options as { choices?: Choice[] } | undefined)?.choices ??
        []) as Choice[],
      counts,
      options: (typeField?.options ?? {}) as Record<string, unknown>,
    };
    const group: FieldGroup = {
      key: picked.id,
      title: picked.name,
      object: "deal",
      pipelineId: picked.id,
      databaseId: picked.databaseId,
      fields,
      required: [],
      builtins: [],
    };
    return { pipeline, types, group };
  });
}

async function loadRecordFields(orgId: string, target: "people" | "companies") {
  return withOrgTx(orgId, async ({ db }): Promise<FieldGroup> => {
    const ids = await crmDatabaseIds(db, orgId);
    const databaseId = target === "companies" ? ids.companies : ids.people;
    const def = databaseId
      ? await db.databaseDefinition.findFirst({
          where: { organizationId: orgId, id: databaseId },
          select: { columns: true },
        })
      : null;
    const builtins =
      target === "companies"
        ? COMPANY_FIELDS.filter((f) => COMPANY_BUILTINS.includes(f.key))
        : PERSON_FIELDS.filter((f) => PERSON_BUILTINS.includes(f.key));
    return {
      key: target,
      title: target === "companies" ? "Companies" : "People",
      object: target === "companies" ? "company" : "person",
      databaseId,
      fields: databaseId ? await loadFields(db, orgId, databaseId) : [],
      required: requiredKeys(def?.columns),
      builtins: builtins.map((f) => ({ key: f.key, label: f.label })),
    };
  });
}

/**
 * Deals and fields: one switch across the top, each pipeline, then People
 * and Companies (?for=, a pipeline's id or those two; old links' ?pipeline=
 * still works). A pipeline shows its stages, types and fields, with its
 * name under More; People and Companies their fields, and People the
 * relationship types. Another pipeline is under More. A Personal space is
 * offered its own ready-made ones (setupKindsFor).
 */
export async function DealsSection({ shell, orgSlug, sp }: SectionProps) {
  const orgId = shell.org.id;
  const asked = sp.for ?? sp.pipeline;
  const records = asked === "people" || asked === "companies" ? asked : null;
  const picked = records
    ? null
    : (shell.pipelines.find((p) => p.id === asked) ?? shell.pipelines[0] ?? null);
  const used = new Set(shell.pipelines.map((p) => p.template));
  const templates = setupKindsFor(shell.access.personal).filter(
    (k) => PIPELINE_TEMPLATES[k] && !used.has(k),
  );
  const target = records ?? "people";
  const data = picked ? await loadPipeline(orgId, picked) : null;
  const group = data ? data.group : await loadRecordFields(orgId, target);
  const base = `/app/${orgSlug}/crm/settings/deals`;
  return (
    <>
      <Segmented
        label="Settings for"
        value={picked ? picked.id : target}
        options={[
          ...shell.pipelines.map((p) => ({
            value: p.id,
            label: p.name,
            href: `${base}?for=${p.id}`,
          })),
          { value: "people", label: "People", href: `${base}?for=people` },
          { value: "companies", label: "Companies", href: `${base}?for=companies` },
        ]}
      />
      {data && (
        <div key={data.pipeline.id} className="space-y-4.5">
          <StagesCard orgId={orgId} pipeline={data.pipeline} />
          <TypesCard orgId={orgId} pipelineId={data.pipeline.id} types={data.types} />
        </div>
      )}
      <div id="fields" className="scroll-mt-24">
        <CustomFieldsCard key={group.key} orgId={orgId} orgSlug={orgSlug} group={group} />
      </div>
      {!picked && target === "people" && (
        <RelationshipTypesCard
          orgId={orgId}
          initial={shell.access.settings?.relationshipTypes ?? []}
        />
      )}
      <SettingsMore>
        {data && <PipelineCard key={data.pipeline.id} orgId={orgId} pipeline={data.pipeline} />}
        <NewPipelineCard orgId={orgId} templates={templates} />
      </SettingsMore>
    </>
  );
}
