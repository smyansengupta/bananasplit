import { Segmented } from "@/components/ui/segmented";
import { PIPELINE_TEMPLATES, setupKindsFor } from "@/lib/crm/templates";
import type { Choice } from "@/lib/databases/fields";
import { loadFields } from "@/server/databases/custom";
import { withOrgTx } from "@/server/db/context";

import {
  NewPipelineCard,
  PipelineCard,
  StagesCard,
  TypesCard,
  type DealTypes,
  type PipelineRow,
} from "../pipeline-settings";
import type { SectionProps } from "./types";

/**
 * Deal stages and types: one pipeline at a time (?pipeline=, a switch when
 * there's more than one), its stages, its deal types and its names, then
 * another pipeline. A Personal space is offered its own ready-made ones
 * (setupKindsFor).
 */
export async function StagesSection({ shell, orgSlug, sp }: SectionProps) {
  const orgId = shell.org.id;
  const picked = shell.pipelines.find((p) => p.id === sp.pipeline) ?? shell.pipelines[0] ?? null;
  const used = new Set(shell.pipelines.map((p) => p.template));
  const templates = setupKindsFor(shell.access.personal).filter(
    (k) => PIPELINE_TEMPLATES[k] && !used.has(k),
  );
  const data = picked
    ? await withOrgTx(orgId, async ({ db }) => {
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
        return { pipeline, types };
      })
    : null;
  const base = `/app/${orgSlug}/crm/settings/stages`;
  return (
    <>
      {shell.pipelines.length > 1 && picked && (
        <Segmented
          label="Pipeline"
          value={picked.id}
          options={shell.pipelines.map((p) => ({
            value: p.id,
            label: p.name,
            href: `${base}?pipeline=${p.id}`,
          }))}
        />
      )}
      {data && (
        <div key={data.pipeline.id} className="space-y-4.5">
          <StagesCard orgId={orgId} pipeline={data.pipeline} />
          <TypesCard orgId={orgId} pipelineId={data.pipeline.id} types={data.types} />
          <PipelineCard orgId={orgId} pipeline={data.pipeline} />
        </div>
      )}
      <NewPipelineCard orgId={orgId} templates={templates} />
    </>
  );
}
