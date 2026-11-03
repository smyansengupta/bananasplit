import type { CrmRunStatus, CrmWorkflowStatus, Prisma } from "@/generated/prisma/client";
import { RECIPES, recipeById, refsIn, resolveRefs, type Recipe, type RecipeRef } from "@/lib/crm/recipes";
import { starterFor } from "@/lib/crm/outreach/starters";
import { PIPELINE_TEMPLATES, SETUP_KIND_INFO, type SetupKind } from "@/lib/crm/templates";
import {
  actionToMergeSyntax,
  describeWorkflow,
  readWorkflow,
  unknownMergeFields,
  workflowInputSchema,
  type RunLogEntry,
  type WorkflowInput,
} from "@/lib/crm/workflows";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, requireManager, type CrmActor } from "./access";

/**
 * Saving, switching and listing workflows (the CRM's Automations tab).
 * Owners, admins and CRM managers shape them (RLS: CrmWorkflow is theirs to
 * write; everyone may read). Every id a workflow names (pipeline, stage,
 * template, sequence, event, member, form) is checked to be this
 * organization's before it's saved.
 */

export interface WorkflowListItem {
  id: string;
  name: string;
  status: CrmWorkflowStatus;
  summary: string;
  recipe: string | null;
  runCount: number;
  lastRunAt: Date | null;
  failedRecently: number;
}

export async function listWorkflows(db: TxClient, organizationId: string): Promise<WorkflowListItem[]> {
  const rows = await db.crmWorkflow.findMany({
    where: { organizationId },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      status: true,
      trigger: true,
      conditions: true,
      actions: true,
      recipe: true,
      runCount: true,
      lastRunAt: true,
    },
  });
  const since = new Date(Date.now() - 7 * 86_400_000);
  const failed = await db.crmWorkflowRun.groupBy({
    by: ["workflowId"],
    where: { organizationId, status: "FAILED", dryRun: false, startedAt: { gte: since } },
    _count: { _all: true },
  });
  const failedBy = new Map(failed.map((f) => [f.workflowId, f._count._all]));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    summary: describeWorkflow(readWorkflow(r)),
    recipe: r.recipe,
    runCount: r.runCount,
    lastRunAt: r.lastRunAt,
    failedRecently: failedBy.get(r.id) ?? 0,
  }));
}

export interface RunView {
  id: string;
  status: CrmRunStatus;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  target: { kind: string; id: string; name: string | null } | null;
  event: string | null;
  log: RunLogEntry[];
}

export async function workflowRuns(db: TxClient, organizationId: string, workflowId: string, take = 30): Promise<RunView[]> {
  const runs = await db.crmWorkflowRun.findMany({
    where: { organizationId, workflowId },
    orderBy: { startedAt: "desc" },
    take,
  });
  const refs = runs.map((r) => r.triggerRef as { kind?: string; id?: string; event?: string } | null);
  const ids = (kind: string) => refs.filter((r) => r?.kind === kind && r.id).map((r) => r!.id!);
  const [people, companies, deals] = await Promise.all([
    db.crmPerson.findMany({ where: { organizationId, id: { in: ids("person") } }, select: { id: true, name: true } }),
    db.crmCompany.findMany({ where: { organizationId, id: { in: ids("company") } }, select: { id: true, name: true } }),
    db.crmDeal.findMany({ where: { organizationId, id: { in: ids("deal") } }, select: { id: true, title: true } }),
  ]);
  const names = new Map<string, string>([
    ...people.map((p) => [`person:${p.id}`, p.name] as const),
    ...companies.map((c) => [`company:${c.id}`, c.name] as const),
    ...deals.map((d) => [`deal:${d.id}`, d.title] as const),
  ]);
  return runs.map((r, i) => {
    const ref = refs[i];
    return {
      id: r.id,
      status: r.status,
      dryRun: r.dryRun,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      target: ref?.kind && ref.id ? { kind: ref.kind, id: ref.id, name: names.get(`${ref.kind}:${ref.id}`) ?? null } : null,
      event: ref?.event ?? null,
      log: Array.isArray(r.log) ? (r.log as unknown as RunLogEntry[]) : [],
    };
  });
}

// ---- Checking what a workflow names ---------------------------------------------------

async function checkIds(actor: CrmActor, input: WorkflowInput): Promise<void> {
  const { db, organizationId } = actor;
  const t = input.trigger.params;
  const pipelineIds = new Set<string>();
  const stageIds = new Set<string>();
  const memberIds = new Set<string>();
  if (t.pipelineId) pipelineIds.add(t.pipelineId);
  if (t.toStageId) stageIds.add(t.toStageId);
  for (const a of input.actions) {
    if (a.type === "deal.create") {
      pipelineIds.add(a.params.pipelineId);
      if (a.params.stageId) stageIds.add(a.params.stageId);
    }
    if (a.type === "stage.move") stageIds.add(a.params.stageId);
    if (a.type === "owner.assign") {
      a.params.userIds.forEach((u) => memberIds.add(u));
      if (a.params.userId) memberIds.add(a.params.userId);
    }
    if ((a.type === "task.create" || a.type === "notify" || a.type === "project.start") && a.params.userId) {
      memberIds.add(a.params.userId);
    }
    if (a.type === "template.send") {
      const ok = await db.crmTemplate.count({ where: { id: a.params.templateId, organizationId, archivedAt: null } });
      if (!ok) throw new CrmError("Pick one of your email templates.");
    }
    if (a.type === "sequence.enroll") {
      const ok = await db.crmSequence.count({ where: { id: a.params.sequenceId, organizationId, archivedAt: null } });
      if (!ok) throw new CrmError("Pick one of your sequences.");
    }
    if (a.type === "event.invite") {
      const ok = await db.event.count({ where: { id: a.params.eventId, organizationId, deletedAt: null } });
      if (!ok) throw new CrmError("Pick one of your events.");
    }
    if (a.type === "stage.move" && input.trigger.type !== "stage.changed" && input.trigger.params.object !== "deal" && input.trigger.type !== "deal.stuck") {
      throw new CrmError("Move to a stage works when the automation is about items.");
    }
  }
  if (pipelineIds.size) {
    const n = await db.crmPipeline.count({ where: { organizationId, id: { in: [...pipelineIds] } } });
    if (n !== pipelineIds.size) throw new CrmError("Pick one of your pipelines.");
  }
  if (stageIds.size) {
    const stages = await db.crmStage.findMany({
      where: { organizationId, id: { in: [...stageIds] } },
      select: { id: true, pipelineId: true },
    });
    if (stages.length !== stageIds.size) throw new CrmError("Pick one of the pipeline's stages.");
    if (t.pipelineId && t.toStageId && stages.find((s) => s.id === t.toStageId)?.pipelineId !== t.pipelineId) {
      throw new CrmError("That stage is in another pipeline.");
    }
  }
  if (memberIds.size) {
    const n = await db.membership.count({ where: { organizationId, userId: { in: [...memberIds] } } });
    if (n !== memberIds.size) throw new CrmError("Pick someone in your organization.");
  }
  if (t.formId) {
    const ok = await db.form.count({ where: { id: t.formId, organizationId } });
    if (!ok) throw new CrmError("Pick one of your forms.");
  }
  if (input.trigger.type === "field.changed" && !t.field) throw new CrmError("Pick the field to watch.");
  if (input.trigger.type === "date.reached" && !t.field) throw new CrmError("Pick the date to go by.");
}

export function parseWorkflowInput(raw: unknown): WorkflowInput {
  const parsed = workflowInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CrmError(issue?.message && !issue.message.startsWith("Invalid") ? issue.message : "Something in the automation isn't filled in right.");
  }
  // Text is saved in the emails' merge-field style ({{name}}); an old {name} is turned into it.
  const actions = parsed.data.actions.map(actionToMergeSyntax);
  const unknown = unknownMergeFields(actions);
  if (unknown.length) throw new CrmError(`There's no field called ${unknown.map((u) => `{{${u}}}`).join(", ")}.`);
  return { ...parsed.data, actions };
}

/** Saves a workflow (a new one starts off, unless `status` says otherwise). */
export async function saveWorkflow(
  actor: CrmActor,
  input: { id?: string | null; workflow: unknown; status?: CrmWorkflowStatus; described?: string | null; recipe?: string | null },
): Promise<{ id: string }> {
  requireManager(await requireCrm(actor));
  const { db, organizationId, userId } = actor;
  const w = parseWorkflowInput(input.workflow);
  await checkIds(actor, w);
  const data = {
    name: w.name,
    trigger: w.trigger as unknown as Prisma.InputJsonObject,
    conditions: w.conditions as unknown as Prisma.InputJsonArray,
    actions: w.actions as unknown as Prisma.InputJsonArray,
  };
  if (input.id) {
    const found = await db.crmWorkflow.findFirst({ where: { id: input.id, organizationId }, select: { id: true } });
    if (!found) throw new CrmError("That automation isn't there any more.");
    await db.crmWorkflow.update({
      where: { id: found.id },
      data: { ...data, ...(input.status ? { status: input.status } : {}) },
    });
    await syncWorkflowTriggers(db, organizationId);
    return { id: found.id };
  }
  const count = await db.crmWorkflow.count({ where: { organizationId } });
  if (count >= 100) throw new CrmError("Your organization has 100 automations. Delete one to make another.");
  const created = await db.crmWorkflow.create({
    data: {
      organizationId,
      ...data,
      status: input.status ?? "OFF",
      recipe: input.recipe ?? null,
      described: input.described?.slice(0, 1000) ?? null,
      createdById: userId,
    },
    select: { id: true },
  });
  await syncWorkflowTriggers(db, organizationId);
  return created;
}

/**
 * Keeps CrmSettings.workflowTriggers (the trigger types of the switched-on
 * workflows) in step, so a member's change can tell whether to queue an
 * event without reading CrmWorkflow, which only managers can.
 */
export async function syncWorkflowTriggers(db: TxClient, organizationId: string): Promise<void> {
  const on = await db.crmWorkflow.findMany({ where: { organizationId, status: "ON" }, select: { trigger: true } });
  const types = [
    ...new Set(
      on
        .map((w) => (w.trigger && typeof w.trigger === "object" ? (w.trigger as { type?: unknown }).type : null))
        .filter((t): t is string => typeof t === "string"),
    ),
  ].sort();
  await db.crmSettings.updateMany({ where: { organizationId }, data: { workflowTriggers: types } });
}

export async function setWorkflowStatus(actor: CrmActor, id: string, status: "ON" | "OFF"): Promise<void> {
  requireManager(await requireCrm(actor));
  const { db, organizationId } = actor;
  const row = await db.crmWorkflow.findFirst({
    where: { id, organizationId },
    select: { id: true, trigger: true, conditions: true, actions: true },
  });
  if (!row) throw new CrmError("That automation isn't there any more.");
  if (status === "ON") {
    const parsed = readWorkflow(row);
    if (!parsed.trigger || parsed.actions.length === 0) throw new CrmError("Finish its When and Then first.");
  }
  await db.crmWorkflow.update({ where: { id: row.id }, data: { status } });
  await syncWorkflowTriggers(db, organizationId);
}

export async function deleteWorkflow(actor: CrmActor, id: string): Promise<void> {
  requireManager(await requireCrm(actor));
  const gone = await actor.db.crmWorkflow.deleteMany({ where: { id, organizationId: actor.organizationId } });
  if (gone.count === 0) throw new CrmError("That automation is already gone.");
  await syncWorkflowTriggers(actor.db, actor.organizationId);
}

// ---- Recipes ---------------------------------------------------------------------------

export interface RecipeView {
  id: string;
  title: string;
  description: string;
  icon: string;
  /** What's missing for it ("the Donations pipeline"), or null when it can be switched on. */
  missing: string | null;
  /** The workflow made from it, if any. */
  workflowId: string | null;
  status: CrmWorkflowStatus | null;
}

interface Resolver {
  pipelines: { id: string; template: string | null; stages: { id: string; key: string | null }[] }[];
  templates: { id: string; category: string | null }[];
}

async function resolverFor(db: TxClient, organizationId: string): Promise<Resolver> {
  const pipelines = await db.crmPipeline.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, template: true, stages: { select: { id: true, key: true } } },
  });
  const templates = await db.crmTemplate.findMany({
    where: { organizationId, archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, category: true },
  });
  return { pipelines, templates };
}

function resolveOne(r: Resolver, ref: RecipeRef): string | null {
  if (ref.kind === "pipeline") return r.pipelines.find((p) => p.template === ref.template)?.id ?? null;
  if (ref.kind === "stage") {
    const p = r.pipelines.find((x) => x.template === ref.template);
    return p?.stages.find((s) => s.key === ref.key)?.id ?? null;
  }
  return r.templates.find((t) => t.category === ref.category)?.id ?? null;
}

function missingFor(recipe: Recipe, r: Resolver): string | null {
  for (const ref of refsIn(recipe)) {
    if (ref.kind === "template") continue; // made on the spot
    if (resolveOne(r, ref) === null) {
      const template = ref.template as SetupKind;
      const name = PIPELINE_TEMPLATES[template]?.name ?? SETUP_KIND_INFO[template]?.label ?? "a pipeline";
      return ref.kind === "pipeline" ? `the ${name} pipeline` : `the ${name} pipeline's ${ref.key.toLowerCase().replace(/_/g, " ")} stage`;
    }
  }
  return null;
}

export async function listRecipes(db: TxClient, organizationId: string): Promise<RecipeView[]> {
  const r = await resolverFor(db, organizationId);
  const made = await db.crmWorkflow.findMany({
    where: { organizationId, recipe: { not: null } },
    select: { id: true, recipe: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  return RECIPES.map((recipe) => {
    const w = made.find((m) => m.recipe === recipe.id);
    return {
      id: recipe.id,
      title: recipe.title,
      description: recipe.description,
      icon: recipe.icon,
      missing: missingFor(recipe, r),
      workflowId: w?.id ?? null,
      status: w?.status ?? null,
    };
  });
}

/** Switches a recipe on: its workflow, made the first time, with starter templates it needs. */
export async function enableRecipe(actor: CrmActor, recipeId: string): Promise<{ id: string }> {
  requireManager(await requireCrm(actor));
  const recipe = recipeById(recipeId);
  if (!recipe) throw new CrmError("That recipe isn't there any more.");
  const { db, organizationId, userId } = actor;
  const existing = await db.crmWorkflow.findFirst({
    where: { organizationId, recipe: recipe.id },
    select: { id: true },
  });
  if (existing) {
    await setWorkflowStatus(actor, existing.id, "ON");
    return existing;
  }
  const r = await resolverFor(db, organizationId);
  const missing = missingFor(recipe, r);
  if (missing) throw new CrmError(`This one needs ${missing}. Add it in CRM settings first.`);
  for (const ref of refsIn(recipe)) {
    if (ref.kind !== "template" || resolveOne(r, ref)) continue;
    const starter = starterFor(ref.category);
    if (!starter) throw new CrmError("A template it needs isn't there.");
    const t = await db.crmTemplate.create({
      data: {
        organizationId,
        name: starter.name,
        category: ref.category,
        subject: starter.subject,
        body: starter.body,
        shared: true,
        createdById: userId,
      },
      select: { id: true, category: true },
    });
    r.templates.push(t);
  }
  const resolved = resolveRefs({ trigger: recipe.trigger, conditions: recipe.conditions, actions: recipe.actions }, (ref) =>
    resolveOne(r, ref),
  );
  if (!resolved) throw new CrmError("This recipe can't be set up for your pipelines.");
  return saveWorkflow(actor, {
    workflow: { name: recipe.title, ...resolved },
    status: "ON",
    recipe: recipe.id,
  });
}
