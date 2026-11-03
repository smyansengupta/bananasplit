import { Prisma, type Role } from "@/generated/prisma/client";
import { safeTimeZone } from "@/lib/calendar/dates";
import {
  conditionsHold,
  loopAllows,
  readWorkflow,
  RUN_CAP_PER_TARGET_PER_HOUR,
  triggerMatches,
  triggerObject,
  underRunCap,
  type RunLogEntry,
  type Trigger,
  type WorkflowObject,
} from "@/lib/crm/workflows";
import { withSystemOrgTx, type OrgContext, type TxClient } from "@/server/db/context";

import type { CrmActor } from "./access";
import { withAutomationScope, type CrmEventPayload } from "./events";
import { rolePositions, type RoleOwner } from "./owners";
import { runAction, type ActionContext } from "./workflow-actions";
import { loadTarget, type WorkflowTarget } from "./workflow-target";

/**
 * The workflow engine (docs/features/crm.md, module 6). An event (events.ts,
 * the crm-event job) or the daily job (scheduled triggers) asks which
 * switched-on workflows it sets off; each one then runs in its own short
 * transaction as its acting member:
 *
 * 1. once per event (the run remembers the job's key, so a retried job
 *    never runs a workflow twice),
 * 2. loop protection: a change one of its own steps made never starts the
 *    same workflow, a chain of automations stops MAX_CHAIN_DEPTH deep, and
 *    a workflow runs at most RUN_CAP_PER_TARGET_PER_HOUR times an hour on
 *    one record,
 * 3. its conditions read the record as it is now,
 * 4. each step in a savepoint, so one failing step is logged and the rest
 *    still run; every step's outcome goes into the run's log (run history).
 *
 * Steps that leave Bananasplit are queued as crm-workflow-call jobs.
 */

export interface WorkflowRow {
  id: string;
  name: string;
  trigger: unknown;
  conditions: unknown;
  actions: unknown;
  createdById: string | null;
}

const WORKFLOW_SELECT = {
  id: true,
  name: true,
  trigger: true,
  conditions: true,
  actions: true,
  createdById: true,
} satisfies Prisma.CrmWorkflowSelect;

interface Acting {
  userId: string;
  role: Role;
  email: string;
  name: string | null;
}

/** Who a workflow acts as: its maker while they still shape the CRM, else an owner. */
export async function actingMember(
  db: TxClient,
  organizationId: string,
  createdById: string | null,
): Promise<Acting | null> {
  const settings = await db.crmSettings.findUnique({ where: { organizationId }, select: { managerIds: true } });
  if (createdById) {
    const m = await db.membership.findUnique({
      where: { userId_organizationId: { userId: createdById, organizationId } },
      select: { role: true, user: { select: { id: true, email: true, name: true } } },
    });
    if (m && (m.role === "OWNER" || m.role === "ADMIN" || settings?.managerIds.includes(createdById))) {
      return { userId: m.user.id, role: m.role, email: m.user.email ?? "", name: m.user.name };
    }
  }
  const owner = await db.membership.findFirst({
    where: { organizationId, role: "OWNER" },
    orderBy: { joinedAt: "asc" },
    select: { role: true, user: { select: { id: true, email: true, name: true } } },
  });
  return owner ? { userId: owner.user.id, role: owner.role, email: owner.user.email ?? "", name: owner.user.name } : null;
}

interface OrgInfo {
  slug: string;
  tz: string;
}

async function orgInfo(db: TxClient, organizationId: string): Promise<OrgInfo> {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { slug: true, timezone: true },
  });
  return { slug: org.slug, tz: safeTimeZone(org.timezone) };
}

/** What set a run off, kept on the run (CrmWorkflowRun.triggerRef). */
export interface TriggerRef {
  kind: WorkflowObject;
  id: string;
  /** The event or schedule, in words ("record.changed", "deal.stuck"). */
  event: string;
  /** Once-only key: the crm-event job's, or the schedule's. */
  key: string;
  /** Who made the change, when a member did. */
  userId?: string | null;
}

export interface RunOutcome {
  status: "DONE" | "FAILED" | "SKIPPED" | "NOT_MET" | "ALREADY" | "GONE";
  runId?: string;
  log?: RunLogEntry[];
}

/**
 * Runs one workflow on one record, in its own transaction (see the header).
 * `extra` adds values the trigger knows (days in stage for a stuck item).
 */
export async function runWorkflowOn(
  organizationId: string,
  workflow: WorkflowRow,
  ref: TriggerRef,
  options: {
    roles: ReadonlyMap<string, RoleOwner>;
    depth?: number;
    extra?: Record<string, string | number | null>;
    now?: Date;
  },
): Promise<RunOutcome> {
  const now = options.now ?? new Date();
  const parsed = readWorkflow(workflow);
  if (!parsed.trigger || parsed.actions.length === 0) return { status: "SKIPPED" };
  const acting = await withSystemOrgTx(organizationId, ({ db }) => actingMember(db, organizationId, workflow.createdById));
  if (!acting) return { status: "SKIPPED" };
  try {
    return await withSystemOrgTx(organizationId, { userId: acting.userId }, async (sys) => {
      const db = sys.db;
      const already = await db.crmWorkflowRun.findFirst({
        where: { organizationId, workflowId: workflow.id, triggerRef: { path: ["key"], equals: ref.key } },
        select: { id: true },
      });
      if (already) return { status: "ALREADY" as const, runId: already.id };
      const recent = await db.crmWorkflowRun.count({
        where: {
          organizationId,
          workflowId: workflow.id,
          dryRun: false,
          startedAt: { gte: new Date(now.getTime() - 3_600_000) },
          triggerRef: { path: ["id"], equals: ref.id },
          status: { not: "SKIPPED" },
        },
      });
      if (!underRunCap(recent)) {
        const noted = await db.crmWorkflowRun.count({
          where: {
            organizationId,
            workflowId: workflow.id,
            status: "SKIPPED",
            startedAt: { gte: new Date(now.getTime() - 3_600_000) },
            triggerRef: { path: ["id"], equals: ref.id },
          },
        });
        if (noted === 0) {
          await db.crmWorkflowRun.create({
            data: {
              organizationId,
              workflowId: workflow.id,
              status: "SKIPPED",
              triggerRef: ref as unknown as Prisma.InputJsonObject,
              log: [
                {
                  action: "trigger",
                  ok: false,
                  detail: `It ran ${RUN_CAP_PER_TARGET_PER_HOUR} times on this in the last hour, so it rests until the hour is up. Check it isn't changing what sets it off.`,
                },
              ] as unknown as Prisma.InputJsonArray,
              finishedAt: now,
            },
          });
        }
        return { status: "SKIPPED" as const };
      }
      const target = await loadTarget(db, organizationId, ref.kind, ref.id);
      if (!target) return { status: "GONE" as const };
      if (options.extra) {
        Object.assign(target.values, options.extra);
        Object.assign(target.merge, options.extra);
      }
      if (!conditionsHold(parsed.conditions, target.values)) return { status: "NOT_MET" as const };
      const counted = await db.crmWorkflow.update({
        where: { id: workflow.id },
        data: { runCount: { increment: 1 }, lastRunAt: now },
        select: { runCount: true },
      });
      const run = await db.crmWorkflowRun.create({
        data: {
          organizationId,
          workflowId: workflow.id,
          status: "RUNNING",
          triggerRef: ref as unknown as Prisma.InputJsonObject,
          startedAt: now,
        },
        select: { id: true },
      });
      const info = await orgInfo(db, organizationId);
      const actor: CrmActor = { db, organizationId, userId: acting.userId, role: acting.role };
      const orgCtx: OrgContext = {
        ...sys,
        kind: "system",
        userId: acting.userId,
        organizationId,
        role: acting.role,
        user: { id: acting.userId, email: acting.email, name: acting.name },
      };
      const ctx: ActionContext = {
        actor,
        orgCtx,
        orgSlug: info.slug,
        workflow: { id: workflow.id, name: workflow.name, turn: counted.runCount - 1 },
        runId: run.id,
        index: 0,
        target,
        roles: options.roles,
        now,
        tz: info.tz,
        dryRun: false,
      };
      const log = await runSteps(ctx, parsed.actions, { workflowId: workflow.id, depth: (options.depth ?? 0) + 1 });
      const failed = log.some((e) => !e.ok && e.detail.startsWith("Failed"));
      await db.crmWorkflowRun.update({
        where: { id: run.id },
        data: {
          status: failed ? "FAILED" : "DONE",
          log: log as unknown as Prisma.InputJsonArray,
          finishedAt: new Date(),
        },
      });
      return { status: failed ? ("FAILED" as const) : ("DONE" as const), runId: run.id, log };
    });
  } catch (error) {
    // The whole run rolled back: keep a failed run so the history says why.
    const message = error instanceof Error ? error.message.slice(0, 300) : "Something went wrong.";
    await withSystemOrgTx(organizationId, ({ db }) =>
      db.crmWorkflowRun.create({
        data: {
          organizationId,
          workflowId: workflow.id,
          status: "FAILED",
          triggerRef: ref as unknown as Prisma.InputJsonObject,
          log: [{ action: "trigger", ok: false, detail: `Failed: ${message}` }] as unknown as Prisma.InputJsonArray,
          finishedAt: new Date(),
        },
      }),
    ).catch(() => undefined);
    return { status: "FAILED" };
  }
}

/** Each step in a savepoint, inside the automation's scope (loop protection). */
async function runSteps(
  ctx: ActionContext,
  actions: ReturnType<typeof readWorkflow>["actions"],
  scope: { workflowId: string; depth: number },
): Promise<RunLogEntry[]> {
  const db = ctx.actor.db;
  const log: RunLogEntry[] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    ctx.index = i;
    if (ctx.dryRun) {
      log.push(await runAction(ctx, action).catch((e) => failedEntry(action.type, e)));
      continue;
    }
    await db.$executeRaw`SAVEPOINT crm_workflow_step`;
    try {
      const entry = await withAutomationScope(scope, () => runAction(ctx, action));
      await db.$executeRaw`RELEASE SAVEPOINT crm_workflow_step`;
      log.push(entry);
    } catch (error) {
      await db.$executeRaw`ROLLBACK TO SAVEPOINT crm_workflow_step`;
      log.push(failedEntry(action.type, error));
    }
  }
  return log;
}

function failedEntry(action: RunLogEntry["action"], error: unknown): RunLogEntry {
  const message = error instanceof Error && error.name === "CrmError" ? error.message : "Something went wrong.";
  if (!(error instanceof Error && error.name === "CrmError")) {
    console.error("[crm] workflow step failed", error instanceof Error ? error.message : error);
  }
  return { action, ok: false, detail: `Failed: ${message}` };
}

// ---- Events ------------------------------------------------------------------------

/** The crm-event job's work: every switched-on workflow this event sets off. */
export async function handleCrmEvent(
  organizationId: string,
  event: CrmEventPayload,
  meta: { jobKey: string },
): Promise<void> {
  if (event.type === "email.bounced" || event.type === "sequence.finished" || event.type === "call.logged") {
    // No trigger reads these yet.
    return;
  }
  const matched = await withSystemOrgTx(organizationId, async ({ db }) => {
    const workflows = await db.crmWorkflow.findMany({
      where: { organizationId, status: "ON" },
      select: WORKFLOW_SELECT,
      orderBy: { createdAt: "asc" },
    });
    if (workflows.length === 0) return [];
    const record: { pipelineId?: string | null; stageId?: string | null; stageKind?: "OPEN" | "WON" | "LOST" | null; formId?: string | null } = {};
    if (event.targetKind === "deal") {
      const d = await db.crmDeal.findFirst({
        where: { id: event.targetId, organizationId },
        select: { pipelineId: true, stageId: true, stage: { select: { kind: true } } },
      });
      if (!d) return [];
      Object.assign(record, { pipelineId: d.pipelineId, stageId: d.stageId, stageKind: d.stage.kind });
    }
    if (event.type === "form.submitted" && event.sourceId) {
      const r = await db.formResponse.findFirst({
        where: { id: event.sourceId, organizationId },
        select: { formId: true },
      });
      record.formId = r?.formId ?? null;
    }
    return workflows.filter((w) => {
      if (!loopAllows(event, w.id)) return false;
      const { trigger } = readWorkflow(w);
      return trigger ? triggerMatches(trigger, { ...event, targetKind: event.targetKind }, record) : false;
    });
  });
  if (matched.length === 0) return;
  const roles = await rolePositions(organizationId);
  for (const w of matched) {
    await runWorkflowOn(
      organizationId,
      w,
      { kind: event.targetKind, id: event.targetId, event: event.type, key: `evt:${meta.jobKey}`, userId: event.userId },
      { roles, depth: event.depth ?? 0 },
    );
  }
}

// ---- Scheduled triggers (the daily job) ------------------------------------------------

const DAY = 86_400_000;
const PER_WORKFLOW = 200;

interface Due {
  id: string;
  /** Once-only key part: the date, the quiet spell or the stage stay it's for. */
  spell: string;
  extra?: Record<string, string | number | null>;
}

const TABLE: Record<WorkflowObject, Prisma.Sql> = {
  person: Prisma.sql`"CrmPerson"`,
  company: Prisma.sql`"CrmCompany"`,
  deal: Prisma.sql`"CrmDeal"`,
};

const COLUMN: Record<string, Prisma.Sql> = {
  nextFollowUpAt: Prisma.sql`t."nextFollowUpAt"`,
  lastContactedAt: Prisma.sql`t."lastContactedAt"`,
  createdAt: Prisma.sql`t."createdAt"`,
  expectedOn: Prisma.sql`t."expectedOn"`,
  nextStepAt: Prisma.sql`t."nextStepAt"`,
  closedAt: Prisma.sql`t."closedAt"`,
};
const DATE_COLUMNS: Record<WorkflowObject, readonly string[]> = {
  person: ["nextFollowUpAt", "lastContactedAt", "createdAt"],
  company: ["nextFollowUpAt", "lastContactedAt", "createdAt"],
  deal: ["expectedOn", "nextStepAt", "closedAt", "createdAt"],
};

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The records a scheduled trigger finds today. */
export async function scheduledTargets(
  db: TxClient,
  organizationId: string,
  trigger: Trigger,
  now: Date,
): Promise<Due[]> {
  const object = triggerObject(trigger);
  const p = trigger.params;
  const pipelineSql =
    object === "deal" && p.pipelineId ? Prisma.sql`AND t."pipelineId" = ${p.pipelineId}` : Prisma.empty;
  if (trigger.type === "date.reached") {
    if (!p.field) return [];
    // The date that is `offset` days before today (the field's day + offset = today), with a day's grace.
    const offset = p.offsetDays ?? 0;
    const today = utcDay(now);
    const want = utcDay(new Date(Date.parse(today) - offset * DAY));
    const graceFrom = utcDay(new Date(Date.parse(want) - DAY));
    if (p.field.startsWith("custom.")) {
      const key = p.field.slice(7);
      const rows = await db.$queryRaw<{ id: string; v: string }[]>`
        SELECT t.id, t.custom->>${key} AS v FROM ${TABLE[object]} t
        WHERE t."organizationId" = ${organizationId} AND t."deletedAt" IS NULL ${pipelineSql}
          AND substr(t.custom->>${key}, 1, 10) BETWEEN ${graceFrom} AND ${want}
        LIMIT ${PER_WORKFLOW}`;
      return rows.map((r) => ({ id: r.id, spell: `${p.field}:${r.v.slice(0, 10)}` }));
    }
    if (!DATE_COLUMNS[object].includes(p.field)) return [];
    const col = COLUMN[p.field]!;
    const rows = await db.$queryRaw<{ id: string; v: Date }[]>`
      SELECT t.id, ${col} AS v FROM ${TABLE[object]} t
      WHERE t."organizationId" = ${organizationId} AND t."deletedAt" IS NULL ${pipelineSql}
        AND ${col} >= ${new Date(`${graceFrom}T00:00:00Z`)} AND ${col} < ${new Date(Date.parse(`${want}T00:00:00Z`) + DAY)}
      LIMIT ${PER_WORKFLOW}`;
    return rows.map((r) => ({ id: r.id, spell: `${p.field}:${utcDay(r.v)}` }));
  }
  if (trigger.type === "no.activity") {
    const days = p.days ?? 30;
    const cutoff = new Date(now.getTime() - days * DAY);
    if (object === "deal") {
      const rows = await db.$queryRaw<{ id: string; last: Date }[]>`
        SELECT t.id, GREATEST(t."stageEnteredAt", COALESCE(MAX(a."occurredAt"), t."createdAt")) AS last
        FROM "CrmDeal" t
        LEFT JOIN "CrmActivityTarget" a
          ON a."organizationId" = t."organizationId" AND a."targetKind" = 'deal' AND a."targetId" = t.id
        WHERE t."organizationId" = ${organizationId} AND t."deletedAt" IS NULL AND t."closedAt" IS NULL ${pipelineSql}
        GROUP BY t.id
        HAVING GREATEST(t."stageEnteredAt", COALESCE(MAX(a."occurredAt"), t."createdAt")) < ${cutoff}
        LIMIT ${PER_WORKFLOW}`;
      return rows.map((r) => ({ id: r.id, spell: `quiet:${r.last.toISOString()}`, extra: { days } }));
    }
    const rows = await db.$queryRaw<{ id: string; last: Date }[]>`
      SELECT t.id, COALESCE(t."lastContactedAt", t."createdAt") AS last FROM ${TABLE[object]} t
      WHERE t."organizationId" = ${organizationId} AND t."deletedAt" IS NULL AND t.status = 'ACTIVE'
        AND COALESCE(t."lastContactedAt", t."createdAt") < ${cutoff}
      ORDER BY last DESC
      LIMIT ${PER_WORKFLOW}`;
    return rows.map((r) => ({ id: r.id, spell: `quiet:${r.last.toISOString()}`, extra: { days } }));
  }
  if (trigger.type === "deal.stuck") {
    const rows = await db.$queryRaw<{ id: string; entered: Date; stageId: string; limit: number | null }[]>`
      SELECT t.id, t."stageEnteredAt" AS entered, t."stageId", s."stuckAfterDays" AS "limit"
      FROM "CrmDeal" t JOIN "CrmStage" s ON s.id = t."stageId" AND s."organizationId" = t."organizationId"
      WHERE t."organizationId" = ${organizationId} AND t."deletedAt" IS NULL AND t."closedAt" IS NULL
        AND s.kind = 'OPEN' ${pipelineSql}
      ORDER BY t."stageEnteredAt" ASC
      LIMIT 2000`;
    const out: Due[] = [];
    for (const r of rows) {
      const limit = p.days ?? r.limit;
      if (!limit) continue;
      const days = Math.floor((now.getTime() - r.entered.getTime()) / DAY);
      if (days < limit) continue;
      out.push({ id: r.id, spell: `stuck:${r.stageId}:${r.entered.toISOString()}`, extra: { days, daysInStage: days } });
      if (out.length >= PER_WORKFLOW) break;
    }
    return out;
  }
  return [];
}

/** The daily pass over every switched-on workflow with a scheduled trigger. */
export async function runScheduledWorkflows(
  organizationId: string,
  now: Date = new Date(),
  deadline = Number.POSITIVE_INFINITY,
): Promise<{ runs: number; more: boolean }> {
  const work = await withSystemOrgTx(organizationId, async ({ db }) => {
    const workflows = await db.crmWorkflow.findMany({
      where: { organizationId, status: "ON" },
      select: WORKFLOW_SELECT,
      orderBy: { createdAt: "asc" },
    });
    const out: { workflow: WorkflowRow; trigger: Trigger; due: Due[] }[] = [];
    for (const w of workflows) {
      const { trigger } = readWorkflow(w);
      if (!trigger || !["date.reached", "no.activity", "deal.stuck"].includes(trigger.type)) continue;
      out.push({ workflow: w, trigger, due: await scheduledTargets(db, organizationId, trigger, now) });
    }
    return out;
  });
  if (work.length === 0) return { runs: 0, more: false };
  const roles = await rolePositions(organizationId);
  let runs = 0;
  for (const { workflow, trigger, due } of work) {
    for (const d of due) {
      if (Date.now() > deadline) return { runs, more: true };
      const r = await runWorkflowOn(
        organizationId,
        workflow,
        { kind: triggerObject(trigger), id: d.id, event: trigger.type, key: `sched:${d.spell}:${d.id}` },
        { roles, extra: d.extra, now },
      );
      if (r.status === "DONE" || r.status === "FAILED") runs++;
    }
  }
  return { runs, more: false };
}

// ---- Dry runs ----------------------------------------------------------------------

export interface DryRunResult {
  target: { kind: WorkflowObject; id: string; name: string } | null;
  conditionsMet: boolean;
  log: RunLogEntry[];
  runId: string | null;
}

/**
 * Tries a saved workflow on one record (the one given, else the newest it
 * could run on) without changing anything: what each step would do, kept
 * in the run history as a dry run. Runs as the member pressing it.
 */
export async function dryRunWorkflow(
  ctx: OrgContext,
  workflowId: string,
  pick?: { kind: WorkflowObject; id: string } | null,
): Promise<DryRunResult> {
  const { db, organizationId } = ctx;
  const row = await db.crmWorkflow.findFirst({ where: { id: workflowId, organizationId }, select: WORKFLOW_SELECT });
  if (!row) return { target: null, conditionsMet: false, log: [], runId: null };
  const parsed = readWorkflow(row);
  if (!parsed.trigger) return { target: null, conditionsMet: false, log: [], runId: null };
  const object = triggerObject(parsed.trigger);
  let ref = pick ?? null;
  const now = new Date();
  const extra: Record<string, string | number | null> = {};
  if (!ref) {
    if (["date.reached", "no.activity", "deal.stuck"].includes(parsed.trigger.type)) {
      const due = await scheduledTargets(db, organizationId, parsed.trigger, now);
      if (due[0]) {
        ref = { kind: object, id: due[0].id };
        Object.assign(extra, due[0].extra ?? {});
      }
    }
    if (!ref) {
      const pipelineId = object === "deal" ? (parsed.trigger.params.pipelineId ?? undefined) : undefined;
      const newest =
        object === "person"
          ? await db.crmPerson.findFirst({ where: { organizationId, deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true } })
          : object === "company"
            ? await db.crmCompany.findFirst({ where: { organizationId, deletedAt: null }, orderBy: { updatedAt: "desc" }, select: { id: true } })
            : await db.crmDeal.findFirst({
                where: { organizationId, deletedAt: null, ...(pipelineId ? { pipelineId } : {}) },
                orderBy: { updatedAt: "desc" },
                select: { id: true },
              });
      if (newest) ref = { kind: object, id: newest.id };
    }
  }
  if (!ref) return { target: null, conditionsMet: false, log: [], runId: null };
  const target: WorkflowTarget | null = await loadTarget(db, organizationId, ref.kind, ref.id);
  if (!target) return { target: null, conditionsMet: false, log: [], runId: null };
  Object.assign(target.values, extra);
  Object.assign(target.merge, extra);
  const met = conditionsHold(parsed.conditions, target.values);
  const roles = await rolePositions(organizationId);
  const info = await orgInfo(db, organizationId);
  const actionCtx: ActionContext = {
    actor: { db, organizationId, userId: ctx.userId, role: ctx.role },
    orgCtx: null,
    orgSlug: info.slug,
    workflow: { id: row.id, name: row.name, turn: 0 },
    runId: null,
    index: 0,
    target,
    roles,
    now,
    tz: info.tz,
    dryRun: true,
  };
  const log: RunLogEntry[] = met
    ? await runSteps(actionCtx, parsed.actions, { workflowId: row.id, depth: 1 })
    : [{ action: "conditions", ok: false, detail: `${target.name} doesn't meet the conditions, so nothing would happen.` }];
  const run = await db.crmWorkflowRun.create({
    data: {
      organizationId,
      workflowId: row.id,
      status: met ? "DONE" : "SKIPPED",
      dryRun: true,
      triggerRef: { kind: ref.kind, id: ref.id, event: "dry-run", key: `dry:${now.getTime()}`, userId: ctx.userId } as Prisma.InputJsonObject,
      log: log as unknown as Prisma.InputJsonArray,
      finishedAt: new Date(),
    },
    select: { id: true },
  });
  return { target: { kind: ref.kind, id: ref.id, name: target.name }, conditionsMet: met, log, runId: run.id };
}
