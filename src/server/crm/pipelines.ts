import type { CrmStageKind, Prisma } from "@/generated/prisma/client";
import { blankPipeline, type PipelineTemplate } from "@/lib/crm/templates";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, requireManager, type CrmActor } from "./access";
import { createPipelineDatabase } from "./databases";
import * as n from "./normalize";

/**
 * Pipelines and their stages (owners', admins' and CRM managers'; RLS
 * agrees). Each pipeline is a database too (CRM_PIPELINE), made with it and
 * renamed with it. A stage with items in it can't be removed until they
 * move; the closing kinds (Won, Lost) carry the pipeline's own labels.
 */

export async function createPipelineFrom(
  actor: CrmActor,
  t: PipelineTemplate,
  sortOrder: number,
): Promise<string> {
  const { db, organizationId, userId } = actor;
  const pipeline = await db.crmPipeline.create({
    data: {
      organizationId,
      name: t.name,
      itemNoun: t.itemNoun,
      itemNounPlural: t.itemNounPlural,
      template: t.template,
      icon: t.icon,
      color: t.color,
      hasAmount: t.hasAmount,
      wonLabel: t.wonLabel,
      lostLabel: t.lostLabel,
      sortOrder,
      createdById: userId,
    },
    select: { id: true, name: true, icon: true },
  });
  await db.crmStage.createMany({
    data: t.stages.map((s, i) => ({
      organizationId,
      pipelineId: pipeline.id,
      name: s.name,
      key: s.key,
      kind: s.kind,
      sortOrder: i,
      probability: s.probability ?? null,
      stuckAfterDays: s.stuckAfterDays ?? null,
      requiredFields: s.requiredFields ?? [],
      color: s.color ?? null,
    })),
  });
  await createPipelineDatabase(actor, pipeline);
  return pipeline.id;
}

export async function createPipeline(
  actor: CrmActor,
  input: { name: string; itemNoun: string; template?: PipelineTemplate | null; hasAmount?: boolean },
): Promise<string> {
  requireManager(await requireCrm(actor));
  const name = n.text(input.name, 60);
  if (!name) throw new CrmError("Give the pipeline a name.");
  const count = await actor.db.crmPipeline.count({
    where: { organizationId: actor.organizationId, archivedAt: null },
  });
  if (count >= 30) throw new CrmError("Up to 30 pipelines.");
  const t = input.template ?? blankPipeline(name, n.text(input.itemNoun, 40) ?? "item");
  return createPipelineFrom(
    actor,
    { ...t, name, hasAmount: input.hasAmount ?? t.hasAmount },
    count,
  );
}

export interface PipelineSettingsInput {
  name?: string;
  itemNoun?: string;
  itemNounPlural?: string;
  hasAmount?: boolean;
  wonLabel?: string;
  lostLabel?: string;
  ownerId?: string | null;
  ownerRoleKey?: string | null;
}

export async function updatePipeline(
  actor: CrmActor,
  pipelineId: string,
  input: PipelineSettingsInput,
): Promise<void> {
  requireManager(await requireCrm(actor));
  const { db, organizationId } = actor;
  const p = await db.crmPipeline.findFirst({
    where: { id: pipelineId, organizationId },
    select: { id: true, databaseId: true },
  });
  if (!p) throw new CrmError("That pipeline isn't here any more.");
  const data: Prisma.CrmPipelineUpdateInput = {};
  const name = n.text(input.name, 60);
  if (name !== undefined) {
    if (!name) throw new CrmError("Give the pipeline a name.");
    data.name = name;
  }
  const noun = n.text(input.itemNoun, 40);
  if (noun) {
    data.itemNoun = noun.toLowerCase();
    data.itemNounPlural = (n.text(input.itemNounPlural, 40) ?? `${noun}s`).toLowerCase();
  }
  if (input.hasAmount !== undefined) data.hasAmount = input.hasAmount;
  const won = n.text(input.wonLabel, 30);
  if (won) data.wonLabel = won;
  const lost = n.text(input.lostLabel, 30);
  if (lost) data.lostLabel = lost;
  if (input.ownerId !== undefined) data.ownerId = n.id(input.ownerId) ?? null;
  if (input.ownerRoleKey !== undefined) data.ownerRoleKey = n.text(input.ownerRoleKey, 100) ?? null;
  await db.crmPipeline.update({ where: { id: p.id }, data });
  if (name && p.databaseId) {
    await db.databaseDefinition.updateMany({
      where: { id: p.databaseId, organizationId },
      data: { name },
    });
  }
}

/** Archives a pipeline and its database; its items stay, unlisted. */
export async function archivePipeline(actor: CrmActor, pipelineId: string): Promise<void> {
  requireManager(await requireCrm(actor));
  const { db, organizationId } = actor;
  const p = await db.crmPipeline.findFirst({
    where: { id: pipelineId, organizationId, archivedAt: null },
    select: { id: true, databaseId: true, template: true },
  });
  if (!p) throw new CrmError("That pipeline isn't here any more.");
  const now = new Date();
  await db.crmPipeline.update({ where: { id: p.id }, data: { archivedAt: now } });
  if (p.databaseId) {
    await db.databaseDefinition.updateMany({
      where: { id: p.databaseId, organizationId },
      data: { archivedAt: now },
    });
  }
}

export interface StageInput {
  id?: string;
  name: string;
  kind: CrmStageKind;
  probability?: number | null;
  stuckAfterDays?: number | null;
  requiredFields?: string[];
}

/**
 * Saves a pipeline's whole stage list in order: renames, new stages, a new
 * order, limits and required fields. A stage left out is removed, unless
 * items sit in it.
 */
export async function saveStages(actor: CrmActor, pipelineId: string, stages: readonly StageInput[]): Promise<void> {
  requireManager(await requireCrm(actor));
  const { db, organizationId } = actor;
  const p = await db.crmPipeline.findFirst({
    where: { id: pipelineId, organizationId },
    select: { id: true, stages: { select: { id: true, name: true } } },
  });
  if (!p) throw new CrmError("That pipeline isn't here any more.");
  if (stages.length === 0) throw new CrmError("A pipeline needs at least one stage.");
  if (stages.length > 20) throw new CrmError("Up to 20 stages.");
  if (!stages.some((s) => s.kind === "OPEN")) throw new CrmError("Keep at least one open stage.");
  const keep = new Set(stages.map((s) => s.id).filter(Boolean));
  for (const old of p.stages) {
    if (keep.has(old.id)) continue;
    const items = await db.crmDeal.count({ where: { organizationId, stageId: old.id } });
    if (items > 0) {
      throw new CrmError(`Move the ${items} in ${old.name} to another stage before removing it.`);
    }
    await db.crmStage.delete({ where: { id: old.id } });
  }
  for (const [i, s] of stages.entries()) {
    const name = n.text(s.name, 40);
    if (!name) throw new CrmError("Give every stage a name.");
    if (!["OPEN", "WON", "LOST"].includes(s.kind)) throw new CrmError("Pick open, won or lost.");
    const data = {
      name,
      kind: s.kind,
      sortOrder: i,
      probability: n.int(s.probability, "Likelihood", 0, 100) ?? null,
      stuckAfterDays: n.int(s.stuckAfterDays, "Stuck after", 1, 365) ?? null,
      requiredFields: (s.requiredFields ?? []).filter((k) => /^[A-Za-z0-9_.-]{1,64}$/.test(k)).slice(0, 20),
    };
    if (s.id && p.stages.some((x) => x.id === s.id)) {
      await db.crmStage.update({ where: { id: s.id }, data });
    } else {
      await db.crmStage.create({ data: { ...data, organizationId, pipelineId: p.id } });
    }
  }
}

export interface PipelineView {
  id: string;
  name: string;
  itemNoun: string;
  itemNounPlural: string;
  template: string | null;
  icon: string | null;
  color: string | null;
  hasAmount: boolean;
  currency: string;
  wonLabel: string;
  lostLabel: string;
  ownerId: string | null;
  ownerRoleKey: string | null;
  databaseId: string | null;
  stages: {
    id: string;
    name: string;
    key: string | null;
    kind: CrmStageKind;
    probability: number | null;
    stuckAfterDays: number | null;
    requiredFields: string[];
    color: string | null;
  }[];
}

export async function listPipelines(db: TxClient, organizationId: string): Promise<PipelineView[]> {
  return db.crmPipeline.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      itemNoun: true,
      itemNounPlural: true,
      template: true,
      icon: true,
      color: true,
      hasAmount: true,
      currency: true,
      wonLabel: true,
      lostLabel: true,
      ownerId: true,
      ownerRoleKey: true,
      databaseId: true,
      stages: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          key: true,
          kind: true,
          probability: true,
          stuckAfterDays: true,
          requiredFields: true,
          color: true,
        },
      },
    },
  });
}
