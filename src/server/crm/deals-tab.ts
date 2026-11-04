import type { Prisma } from "@/generated/prisma/client";
import {
  dealAmbient,
  dealTypeField,
  dealTypeOf,
  nextOpenStage,
  type DealAmbient,
  type DealsFilters,
  type DealType,
  type StageLike,
} from "@/lib/crm/deals-tab";
import type { FieldDef } from "@/lib/databases/fields";
import type { TxClient } from "@/server/db/context";

import { customFieldsFor } from "./databases";
import { ownerLabel, rolesHeldBy, type RoleOwner } from "./owners";
import type { PipelineView } from "./pipelines";

/**
 * The Deals tab's rows (docs/features/crm.md, "Redesign"), read as the
 * viewer (RLS decides): every deal in the pipelines shown, filtered by
 * owner, type, open/won/lost and search, each with its type, its next step
 * and what it asks of you (dealAmbient).
 */

export interface DealRow {
  id: string;
  title: string;
  pipelineId: string;
  stageId: string;
  stageKind: "OPEN" | "WON" | "LOST";
  amountCents: number | null;
  currency: string;
  companyName: string | null;
  owner: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  type: DealType | null;
  ambient: DealAmbient | null;
  /** The stage Next stage moves it to. */
  nextStageId: string | null;
  /** Board: days in its stage and whether that's past the stage's limit. */
  days: number;
  stuck: boolean;
  closeReason: string | null;
  sponsorship: boolean;
}

export interface DealsTabData {
  rows: DealRow[];
  stages: StageLike[];
  /** Each shown pipeline's Type field (null where it has none yet). */
  typeFields: Map<string, FieldDef | null>;
  /** Every type label in use or offered, for Filters. */
  typeLabels: string[];
}

const DAY = 86_400_000;

export async function loadDealsTab(
  db: TxClient,
  organizationId: string,
  pipelines: readonly PipelineView[],
  filters: DealsFilters,
  viewer: { id: string; roles: ReadonlyMap<string, RoleOwner>; names: ReadonlyMap<string, string> },
  now: Date = new Date(),
): Promise<DealsTabData> {
  const shown = filters.pipeline ? pipelines.filter((p) => p.id === filters.pipeline) : [...pipelines];
  const stages: StageLike[] = shown.flatMap((p) =>
    p.stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, pipelineId: p.id, pipelineName: p.name })),
  );
  const typeFields = new Map<string, FieldDef | null>();
  for (const p of shown) typeFields.set(p.id, dealTypeField(await customFieldsFor(db, organizationId, "deal", p.id)));
  const typeLabels = [
    ...new Set(
      [...typeFields.values()].flatMap((f) => f?.options.choices?.map((c) => c.label) ?? []),
    ),
  ];
  if (shown.length === 0) return { rows: [], stages, typeFields, typeLabels };

  const and: Prisma.CrmDealWhereInput[] = [
    { organizationId, deletedAt: null, pipelineId: { in: shown.map((p) => p.id) } },
  ];
  if (filters.show === "open") and.push({ stage: { kind: "OPEN" } });
  if (filters.show === "won") and.push({ stage: { kind: "WON" } });
  if (filters.show === "lost") and.push({ stage: { kind: "LOST" } });
  if (filters.owner === "none") and.push({ ownerId: null, ownerRoleKey: null });
  else if (filters.owner) {
    const id = filters.owner === "me" ? viewer.id : filters.owner;
    const held = rolesHeldBy(id, viewer.roles);
    and.push({ OR: [{ ownerId: id }, ...(held.length ? [{ ownerRoleKey: { in: held } }] : [])] });
  }
  if (filters.type) {
    // A type is a choice id per pipeline: match whichever pipelines have it.
    const or: Prisma.CrmDealWhereInput[] = [];
    for (const [pipelineId, field] of typeFields) {
      const choice = field?.options.choices?.find((c) => c.label.toLowerCase() === filters.type);
      if (field && choice) or.push({ pipelineId, custom: { path: [field.id], equals: choice.id } });
    }
    and.push(or.length ? { OR: or } : { id: "" });
  }
  if (filters.q) {
    and.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { company: { name: { contains: filters.q, mode: "insensitive" } } },
        { nextStep: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }

  const found = await db.crmDeal.findMany({
    where: { AND: and },
    orderBy: [{ rank: "asc" }, { id: "asc" }],
    take: 2000,
    select: {
      id: true,
      title: true,
      pipelineId: true,
      stageId: true,
      amountCents: true,
      currency: true,
      ownerId: true,
      ownerRoleKey: true,
      nextStep: true,
      nextStepAt: true,
      stageEnteredAt: true,
      closedAt: true,
      closeReason: true,
      sponsorshipId: true,
      custom: true,
      company: { select: { name: true } },
      stage: { select: { kind: true, name: true, stuckAfterDays: true } },
    },
  });

  const stagesOf = new Map(shown.map((p) => [p.id, p.stages]));
  const rows: DealRow[] = found.map((d) => {
    const next = nextOpenStage(stagesOf.get(d.pipelineId) ?? [], d.stageId);
    const closed = d.stage.kind !== "OPEN";
    const days = Math.max(0, Math.floor((now.getTime() - d.stageEnteredAt.getTime()) / DAY));
    return {
      id: d.id,
      title: d.title,
      pipelineId: d.pipelineId,
      stageId: d.stageId,
      stageKind: d.stage.kind,
      amountCents: d.amountCents,
      currency: d.currency,
      companyName: d.company?.name ?? null,
      owner: ownerLabel(d, viewer.roles, viewer.names),
      nextStep: d.nextStep,
      nextStepAt: d.nextStepAt?.toISOString() ?? null,
      type: dealTypeOf(typeFields.get(d.pipelineId) ?? null, d.custom),
      ambient: dealAmbient(
        {
          closed,
          nextStep: d.nextStep,
          nextStepAt: d.nextStepAt,
          stageEnteredAt: d.stageEnteredAt,
          stageName: d.stage.name,
          stuckAfterDays: d.stage.stuckAfterDays,
          nextStage: next,
        },
        now,
      ),
      nextStageId: next?.id ?? null,
      days,
      stuck: !closed && Boolean(d.stage.stuckAfterDays) && days > (d.stage.stuckAfterDays ?? 0),
      closeReason: d.closeReason,
      sponsorship: Boolean(d.sponsorshipId),
    };
  });
  return { rows, stages, typeFields, typeLabels };
}

/** The pipeline Deals opens on when there are several: the ready-made Deals one, else the first. */
export function defaultDealPipeline<P extends { template: string | null }>(pipelines: readonly P[]): P | null {
  return pipelines.find((p) => p.template === "sponsors") ?? pipelines[0] ?? null;
}
