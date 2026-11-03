import type { Prisma } from "@/generated/prisma/client";
import {
  diffRows,
  historySourceOf,
  isQueueKind,
  parsePayload,
  PAYLOADS,
  QUEUE_KINDS,
  type Applied,
  type Citation,
  type DiffRow,
  type FieldChange,
  type PayloadOf,
  type QueueKind,
  type SuggestionSource,
  type TargetKind,
  type TargetRef,
} from "@/lib/crm/suggestions";
import { builtinField, customKey } from "@/lib/crm/fields";
import { NotFoundError } from "@/lib/auth/errors";
import type { OrgContext, TxClient } from "@/server/db/context";
import { notifyUser } from "@/server/notifications";
import { createTask, deleteTask, loadTaskEnv, TaskError } from "@/server/tasks/service";

import { CrmError, requireCrm, type CrmActor } from "./access";
import { logActivity } from "./activity";
import { undoBatch } from "./bulk";
import { createCompany, trashCompanies, updateCompany, type CompanyInput } from "./companies";
import { moveDeal, updateDeal, type DealInput } from "./deals";
import { newBatchId } from "./history";
import { createPerson, personByEmail, trashPeople, updatePerson, type PersonInput } from "./people";
import { recordEnrichment } from "./enrichment-store";

/**
 * The review queue (docs/features/crm.md, differentiator 6): one place where
 * every AI change, automation proposal, connected-app write and email-
 * sourced suggestion waits as a before and after with its citation, for a
 * person to accept or reject in one click.
 *
 * For other phases:
 *   proposeChange(db, input)       queue a change (any transaction, member or
 *                                  service path); returns its id
 *   acceptSuggestion(ctx, id)      apply it through the CRM's own functions,
 *                                  history source "ai" / "connector" / ...
 *   rejectSuggestion(ctx, id)      say no
 *   undoSuggestion(ctx, id)        take an accepted one back (it waits again)
 *   acceptSuggestions(ctx, ids)    accept a batch, one savepoint each
 *
 * Accepting runs as the reviewer under RLS, so a suggestion can never do
 * more than its reviewer could do by hand. The proposer is only recorded.
 */

export interface ProposeInput {
  organizationId: string;
  kind: QueueKind;
  source: SuggestionSource;
  /** One short line: "Update Mara Quinn's title". */
  title: string;
  summary?: string | null;
  payload: unknown;
  target?: TargetRef | null;
  citation?: Citation | null;
  /** Who should review it (notified, Inbox); null: anyone who can edit the target. */
  assigneeId?: string | null;
  /** The member who asked for it (an Ask, an AI button, their own connected app). */
  proposedById?: string | null;
  expiresAt?: Date | null;
}

/** Queues one change; an identical one already waiting is returned instead. */
export async function proposeChange(
  db: TxClient,
  input: ProposeInput,
): Promise<{ id: string; duplicate: boolean }> {
  if (!isQueueKind(input.kind)) throw new CrmError("That kind of change can't be suggested.");
  let payload = PAYLOADS[input.kind].parse(input.payload) as Record<string, unknown>;
  if (input.kind === "UPDATE_FIELD" && input.target) {
    payload = { changes: await withBefore(db, input.organizationId, input.target, payload.changes as FieldChange[]) };
  }
  const json = payload as Prisma.InputJsonObject;
  const existing = await db.crmSuggestion.findFirst({
    where: {
      organizationId: input.organizationId,
      kind: input.kind,
      status: "PENDING",
      targetKind: input.target?.kind ?? null,
      targetId: input.target?.id ?? null,
      payload: { equals: json },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, duplicate: true };
  const row = await db.crmSuggestion.create({
    data: {
      organizationId: input.organizationId,
      kind: input.kind,
      source: input.source,
      title: input.title.trim().slice(0, 300) || "A suggestion",
      summary: input.summary?.slice(0, 2000) ?? null,
      payload: json,
      targetKind: input.target?.kind ?? null,
      targetId: input.target?.id ?? null,
      citation: (input.citation ?? {}) as Prisma.InputJsonObject,
      assigneeId: input.assigneeId ?? null,
      proposedById: input.proposedById ?? null,
      expiresAt: input.expiresAt ?? null,
    },
    select: { id: true },
  });
  if (input.assigneeId && input.assigneeId !== input.proposedById) {
    const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { slug: true } });
    if (org) {
      await notifyUser(db, input.organizationId, input.assigneeId, {
        type: "CRM_REVIEW",
        title: input.title.slice(0, 200),
        body: input.summary ?? "Waiting for your review in the CRM.",
        linkUrl: `/app/${org.slug}/crm/queue`,
        actorId: input.proposedById ?? null,
        dedupeKey: `crm-review:${row.id}`,
      });
    }
  }
  return { id: row.id, duplicate: false };
}

// ---------------------------------------------------------------- reading the queue

export interface QueueItem {
  id: string;
  kind: QueueKind;
  source: SuggestionSource;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  title: string;
  summary: string | null;
  rows: DiffRow[];
  target: { kind: TargetKind; id: string; name: string } | null;
  citation: Citation | null;
  assigneeId: string | null;
  proposedById: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  /** Accepted and still undoable by this viewer. */
  undoable: boolean;
  payload: Record<string, unknown>;
}

function citationOf(raw: unknown): Citation | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.kind !== "string" || typeof c.label !== "string") return null;
  return c as unknown as Citation;
}

/** Names of the records a page of suggestions is about, as the viewer sees them (RLS hides the rest). */
async function targetNames(
  db: TxClient,
  organizationId: string,
  refs: readonly { kind: string | null; id: string | null }[],
): Promise<Map<string, string>> {
  const ids = (kind: string) => [...new Set(refs.filter((r) => r.kind === kind && r.id).map((r) => r.id!))];
  const out = new Map<string, string>();
  const people = ids("person");
  if (people.length) {
    for (const p of await db.crmPerson.findMany({ where: { organizationId, id: { in: people } }, select: { id: true, name: true } })) {
      out.set(`person:${p.id}`, p.name);
    }
  }
  const companies = ids("company");
  if (companies.length) {
    for (const c of await db.crmCompany.findMany({ where: { organizationId, id: { in: companies } }, select: { id: true, name: true } })) {
      out.set(`company:${c.id}`, c.name);
    }
  }
  const deals = ids("deal");
  if (deals.length) {
    for (const d of await db.crmDeal.findMany({ where: { organizationId, id: { in: deals } }, select: { id: true, title: true } })) {
      out.set(`deal:${d.id}`, d.title);
    }
  }
  return out;
}

export interface QueueQuery {
  status?: "PENDING" | "DONE";
  /** Only what's assigned to the viewer (or to nobody). */
  mine?: boolean;
  target?: TargetRef;
  take?: number;
}

/**
 * The queue as `viewerId` may see it: a suggestion about a record they
 * can't see (OWN access) is left out, unless it's assigned to them or they
 * proposed it. Pending first, newest first.
 */
export async function listQueue(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  query: QueueQuery = {},
): Promise<QueueItem[]> {
  const take = Math.min(query.take ?? 100, 300);
  const rows = await db.crmSuggestion.findMany({
    where: {
      organizationId,
      kind: { in: [...QUEUE_KINDS] },
      status: query.status === "DONE" ? { in: ["ACCEPTED", "REJECTED"] } : "PENDING",
      ...(query.mine ? { OR: [{ assigneeId: viewerId }, { assigneeId: null }] } : {}),
      ...(query.target ? { targetKind: query.target.kind, targetId: query.target.id } : {}),
    },
    orderBy: query.status === "DONE" ? [{ reviewedAt: "desc" }] : [{ createdAt: "desc" }],
    take,
  });
  const names = await targetNames(db, organizationId, rows.map((r) => ({ kind: r.targetKind, id: r.targetId })));
  const out: QueueItem[] = [];
  for (const r of rows) {
    if (!isQueueKind(r.kind)) continue;
    const name = r.targetKind && r.targetId ? names.get(`${r.targetKind}:${r.targetId}`) : undefined;
    const hidden = Boolean(r.targetId) && name === undefined;
    if (hidden && r.assigneeId !== viewerId && r.proposedById !== viewerId) continue;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const applied = payload.applied as Applied | undefined;
    out.push({
      id: r.id,
      kind: r.kind,
      source: r.source,
      status: r.status,
      title: r.title,
      summary: r.summary,
      rows: diffRows(r.kind, payload),
      target:
        r.targetKind && r.targetId
          ? { kind: r.targetKind as TargetKind, id: r.targetId, name: name ?? "A record you can't see" }
          : null,
      citation: citationOf(r.citation),
      assigneeId: r.assigneeId,
      proposedById: r.proposedById,
      reviewedById: r.reviewedById,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
      undoable: r.status === "ACCEPTED" && r.reviewedById === viewerId && Boolean(applied),
      payload,
    });
  }
  return out;
}

/** How many are waiting for the viewer (theirs, or nobody's): the tab's badge. */
export async function queueCount(db: TxClient, organizationId: string, viewerId: string): Promise<number> {
  return db.crmSuggestion.count({
    where: {
      organizationId,
      kind: { in: [...QUEUE_KINDS] },
      status: "PENDING",
      OR: [{ assigneeId: viewerId }, { assigneeId: null }],
    },
  });
}

// ---------------------------------------------------------------- accepting

type Row = Awaited<ReturnType<TxClient["crmSuggestion"]["findFirst"]>> & object;

async function loadPending(db: TxClient, organizationId: string, id: string): Promise<Row> {
  const row = await db.crmSuggestion.findFirst({ where: { id, organizationId } });
  if (!row || !isQueueKind(row.kind)) throw new NotFoundError();
  if (row.status !== "PENDING") {
    throw new CrmError(row.status === "ACCEPTED" ? "That was already accepted." : "That was already dealt with.");
  }
  return row;
}

/** The record's current values for the fields a change names (its "before"). */
async function withBefore(
  db: TxClient,
  organizationId: string,
  target: TargetRef,
  changes: readonly FieldChange[],
): Promise<FieldChange[]> {
  const current = await currentValues(db, organizationId, target);
  if (!current) return [...changes];
  return changes.map((c) => (c.before !== undefined ? c : { ...c, before: valueAt(current, c.field) ?? null }));
}

function valueAt(record: Record<string, unknown>, field: string): unknown {
  if (field.startsWith("custom.")) return (record.custom as Record<string, unknown> | undefined)?.[field.slice(7)];
  if (field === "companyName") return (record.company as { name?: string } | null)?.name ?? null;
  if (field === "amount") return typeof record.amountCents === "number" ? record.amountCents / 100 : null;
  const v = record[field];
  return v instanceof Date ? v.toISOString().slice(0, 10) : v;
}

export async function currentValues(
  db: TxClient,
  organizationId: string,
  target: TargetRef,
): Promise<Record<string, unknown> | null> {
  if (target.kind === "person") {
    return db.crmPerson.findFirst({
      where: { id: target.id, organizationId },
      include: { company: { select: { name: true } } },
    }) as Promise<Record<string, unknown> | null>;
  }
  if (target.kind === "company") {
    return db.crmCompany.findFirst({ where: { id: target.id, organizationId } }) as Promise<Record<string, unknown> | null>;
  }
  return db.crmDeal.findFirst({ where: { id: target.id, organizationId } }) as Promise<Record<string, unknown> | null>;
}

/** Which built-in keys a change may set on each kind of record. */
const SETTABLE: Record<TargetKind, ReadonlySet<string>> = {
  person: new Set([
    "name",
    "firstName",
    "lastName",
    "primaryEmail",
    "phone",
    "title",
    "companyName",
    "companyId",
    "linkedinUrl",
    "website",
    "location",
    "relationship",
    "status",
    "nextFollowUpAt",
    "keepInTouchDays",
    "doNotContact",
    "source",
  ]),
  company: new Set(["name", "domain", "website", "industry", "size", "phone", "address", "description", "status", "nextFollowUpAt"]),
  deal: new Set(["title", "amount", "expectedOn", "nextStep", "nextStepAt", "forecastCategory", "closeReason", "source", "companyId", "primaryPersonId"]),
};

/** A change's fields as the core's input: built-ins by key, custom ones under `custom`. */
export function patchOf(kind: TargetKind, changes: readonly FieldChange[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  for (const c of changes) {
    if (c.field.startsWith("custom.")) {
      custom[c.field.slice(7)] = c.after;
      continue;
    }
    if (!SETTABLE[kind].has(c.field)) {
      throw new CrmError(`"${c.label || c.field}" can't be changed from a suggestion.`);
    }
    patch[c.field] = c.after;
  }
  if (Object.keys(custom).length > 0) patch.custom = custom;
  return patch;
}

async function updateTarget(
  actor: CrmActor,
  target: TargetRef,
  patch: Record<string, unknown>,
  options: { source: ReturnType<typeof historySourceOf>; batchId: string },
): Promise<void> {
  const opts = { source: options.source, batchId: options.batchId, trusted: true };
  if (target.kind === "person") await updatePerson(actor, target.id, patch as PersonInput, opts);
  else if (target.kind === "company") await updateCompany(actor, target.id, patch as CompanyInput, opts);
  else await updateDeal(actor, target.id, patch as DealInput, opts);
}

const LINK_KIND: Record<TargetKind, string> = { person: "crm-person", company: "crm-company", deal: "crm-deal" };

/** A task from a suggestion, linked to the record (so it lands on its timeline). */
async function makeTask(ctx: OrgContext, task: PayloadOf<"CREATE_TASK">, target: TargetRef | null): Promise<string> {
  const env = await loadTaskEnv(ctx);
  let result;
  try {
    result = await createTask(env, {
      title: task.title,
      description: task.description ?? null,
      ownerId: task.ownerId ?? ctx.userId,
      dueDate: task.dueDate ?? null,
      // An assignment above the reviewer's level is theirs to confirm, as it would be by hand.
      confirmFlagged: true,
    });
  } catch (error) {
    if (error instanceof TaskError) throw new CrmError(error.message);
    throw error;
  }
  if (result.error) throw new CrmError(result.error);
  if (!result.taskId) throw new CrmError("The task couldn't be made.");
  if (target) {
    await ctx.db.itemLink.create({
      data: {
        organizationId: ctx.organizationId,
        fromKind: "task",
        fromId: result.taskId,
        toKind: LINK_KIND[target.kind],
        toId: target.id,
        createdById: ctx.userId,
      },
    });
  }
  return result.taskId;
}

/** Sets a record's next follow-up to `day` (a follow-up promise), in the batch. */
async function followUpOn(
  actor: CrmActor,
  target: TargetRef,
  day: string,
  title: string,
  options: { source: ReturnType<typeof historySourceOf>; batchId: string },
): Promise<void> {
  if (target.kind === "deal") {
    await updateTarget(actor, target, { nextStep: title.slice(0, 200), nextStepAt: day }, options);
  } else {
    await updateTarget(actor, target, { nextFollowUpAt: day }, options);
  }
}

async function makeDraft(ctx: OrgContext, draft: PayloadOf<"DRAFT_EMAIL">): Promise<string> {
  const me = await ctx.db.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
  const thread = await ctx.db.crmEmailThread.create({
    data: { organizationId: ctx.organizationId, subject: draft.subject },
    select: { id: true },
  });
  await ctx.db.crmEmailMessage.create({
    data: {
      organizationId: ctx.organizationId,
      threadId: thread.id,
      direction: "OUTBOUND",
      status: "DRAFT",
      mailbox: "ORG_SENDER",
      mailboxUserId: ctx.userId,
      fromAddress: me?.email ?? "",
      toAddresses: draft.to,
      subject: draft.subject,
      bodyText: draft.body,
      createdById: ctx.userId,
    },
  });
  return thread.id;
}

function activityTargets(payload: PayloadOf<"LOG_ACTIVITY">, target: TargetRef | null): TargetRef[] {
  const out = [...payload.targets];
  if (target && !out.some((t) => t.kind === target.kind && t.id === target.id)) out.unshift(target);
  return out;
}

async function apply(ctx: OrgContext, row: Row, kind: QueueKind, payload: unknown): Promise<Applied> {
  const target: TargetRef | null =
    row.targetKind && row.targetId ? { kind: row.targetKind as TargetKind, id: row.targetId } : null;
  const source = historySourceOf(row.source);
  const batchId = newBatchId();
  const applied: Applied = { at: new Date().toISOString() };
  const citation = citationOf(row.citation);
  const meta = { suggestionId: row.id, ...(citation ? { citation: citation.label } : {}) };
  switch (kind) {
    case "CREATE_PERSON": {
      const p = parsePayload("CREATE_PERSON", payload);
      if (p.person.primaryEmail) {
        const existing = await personByEmail(ctx.db, ctx.organizationId, p.person.primaryEmail);
        if (existing && !existing.deletedAt) throw new CrmError("Someone with that email is already in the CRM.");
      }
      const { id } = await createPerson(
        ctx,
        { ...p.person, source: row.source === "CONNECTOR" ? "connected app" : "ai", sourceDetail: citation?.label ?? null },
        { source, batchId, trusted: true },
      );
      applied.createdKind = "person";
      applied.createdId = id;
      if (p.activity) {
        applied.activityId = await logActivity(ctx.db, {
          organizationId: ctx.organizationId,
          kind: p.activity.kind,
          subject: p.activity.subject,
          body: p.activity.body,
          occurredAt: p.activity.occurredAt ? new Date(p.activity.occurredAt) : undefined,
          direction: p.activity.direction ?? null,
          targets: [{ kind: "person", id }],
          actorId: ctx.userId,
          createdById: ctx.userId,
          meta,
        });
      }
      if (p.task) applied.taskId = await makeTask(ctx, p.task, { kind: "person", id });
      if (citation) await recordEnrichment(ctx.db, ctx.organizationId, { kind: "person", id }, Object.keys(p.person).filter((k) => p.person[k as keyof typeof p.person]), source, citation, ctx.userId);
      return applied;
    }
    case "CREATE_COMPANY": {
      const c = parsePayload("CREATE_COMPANY", payload);
      const { id } = await createCompany(ctx, c.company, { source, batchId, trusted: true });
      applied.createdKind = "company";
      applied.createdId = id;
      return applied;
    }
    case "UPDATE_FIELD": {
      if (!target) throw new CrmError("This change doesn't say which record it's for.");
      const u = parsePayload("UPDATE_FIELD", payload);
      await updateTarget(ctx, target, patchOf(target.kind, u.changes), { source, batchId });
      applied.batchId = batchId;
      if (citation) {
        await recordEnrichment(ctx.db, ctx.organizationId, target, u.changes.map((c) => c.field), source, citation, ctx.userId);
      }
      return applied;
    }
    case "MOVE_STAGE": {
      if (!target || target.kind !== "deal") throw new CrmError("A stage move needs an item.");
      const m = parsePayload("MOVE_STAGE", payload);
      const r = await moveDeal(ctx, target.id, { stageId: m.stageId, closeReason: m.closeReason }, { source, batchId, trusted: true });
      if (r.needs) throw new CrmError(`Fill in ${r.needs.labels.join(", ")} on the item first, then accept.`);
      applied.batchId = batchId;
      return applied;
    }
    case "LOG_ACTIVITY": {
      const a = parsePayload("LOG_ACTIVITY", payload);
      const targets = activityTargets(a, target);
      if (targets.length === 0) throw new CrmError("This doesn't say who it's about.");
      applied.activityId = await logActivity(ctx.db, {
        organizationId: ctx.organizationId,
        kind: a.kind,
        subject: a.subject,
        body: a.body,
        occurredAt: a.occurredAt ? new Date(a.occurredAt) : undefined,
        direction: a.direction ?? null,
        targets,
        actorId: ctx.userId,
        createdById: ctx.userId,
        meta,
      });
      return applied;
    }
    case "DRAFT_EMAIL": {
      const d = parsePayload("DRAFT_EMAIL", payload);
      applied.threadId = await makeDraft(ctx, d);
      return applied;
    }
    case "CREATE_TASK": {
      const t = parsePayload("CREATE_TASK", payload);
      applied.taskId = await makeTask(ctx, t, target);
      if (t.followUp && t.dueDate && target) {
        await followUpOn(ctx, target, t.dueDate, t.title, { source, batchId });
        applied.batchId = batchId;
      }
      return applied;
    }
  }
}

/** Fields a reviewer may change before accepting (the draft's words, a task's day). */
function mergeEdits(kind: QueueKind, payload: Record<string, unknown>, edits: unknown): unknown {
  if (!edits || typeof edits !== "object") return payload;
  const e = edits as Record<string, unknown>;
  if (kind === "DRAFT_EMAIL") {
    return {
      ...payload,
      ...(typeof e.subject === "string" ? { subject: e.subject } : {}),
      ...(typeof e.body === "string" ? { body: e.body } : {}),
      ...(Array.isArray(e.to) ? { to: e.to } : {}),
    };
  }
  if (kind === "CREATE_TASK") {
    return {
      ...payload,
      ...(typeof e.title === "string" ? { title: e.title } : {}),
      ...(typeof e.dueDate === "string" || e.dueDate === null ? { dueDate: e.dueDate } : {}),
    };
  }
  if (kind === "LOG_ACTIVITY") {
    return { ...payload, ...(typeof e.body === "string" ? { body: e.body } : {}) };
  }
  return payload;
}

/**
 * Accepts one suggestion as the reviewer (ctx): applies it through the
 * CRM's own functions in this transaction and marks it accepted, keeping
 * what it did for Undo. A refusal (a rule, a missing field) throws and
 * nothing is kept.
 */
export async function acceptSuggestion(
  ctx: OrgContext,
  id: string,
  edits?: unknown,
): Promise<{ id: string; applied: Applied }> {
  await requireCrm(ctx);
  const row = await loadPending(ctx.db, ctx.organizationId, id);
  const kind = row.kind as QueueKind;
  const base = (row.payload ?? {}) as Record<string, unknown>;
  const payload = PAYLOADS[kind].parse(mergeEdits(kind, base, edits)) as Record<string, unknown>;
  const applied = await apply(ctx, row, kind, payload);
  await ctx.db.crmSuggestion.update({
    where: { id: row.id },
    data: {
      status: "ACCEPTED",
      reviewedById: ctx.userId,
      reviewedAt: new Date(),
      payload: { ...payload, applied } as unknown as Prisma.InputJsonObject,
    },
  });
  return { id: row.id, applied };
}

export async function rejectSuggestion(ctx: CrmActor, id: string): Promise<void> {
  await requireCrm(ctx);
  const row = await loadPending(ctx.db, ctx.organizationId, id);
  await ctx.db.crmSuggestion.update({
    where: { id: row.id },
    data: { status: "REJECTED", reviewedById: ctx.userId, reviewedAt: new Date() },
  });
}

/**
 * Accepts several: each in its own savepoint, so one that is refused is
 * reported and the rest still go in.
 */
export async function acceptSuggestions(
  ctx: OrgContext,
  ids: readonly string[],
): Promise<{ accepted: string[]; failed: { id: string; error: string }[] }> {
  await requireCrm(ctx);
  const accepted: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const id of ids.slice(0, 200)) {
    await ctx.db.$executeRaw`SAVEPOINT crm_accept`;
    try {
      await acceptSuggestion(ctx, id);
      await ctx.db.$executeRaw`RELEASE SAVEPOINT crm_accept`;
      accepted.push(id);
    } catch (error) {
      await ctx.db.$executeRaw`ROLLBACK TO SAVEPOINT crm_accept`;
      failed.push({ id, error: error instanceof CrmError ? error.message : "That one couldn't be applied." });
    }
  }
  return { accepted, failed };
}

/**
 * Takes an accepted suggestion back: field changes are undone through the
 * batch Undo, a record it made goes to the trash, a timeline entry or task
 * it made is removed, a draft is deleted. It then waits in the queue again.
 * Only whoever accepted it can undo it.
 */
export async function undoSuggestion(ctx: OrgContext, id: string): Promise<void> {
  await requireCrm(ctx);
  const row = await ctx.db.crmSuggestion.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!row || !isQueueKind(row.kind)) throw new NotFoundError();
  if (row.status !== "ACCEPTED") throw new CrmError("Only an accepted suggestion can be undone.");
  if (row.reviewedById !== ctx.userId) throw new CrmError("Only the person who accepted it can undo it.");
  const { applied, ...payload } = (row.payload ?? {}) as Record<string, unknown> & { applied?: Applied };
  if (!applied) throw new CrmError("There's nothing left to undo.");
  if (applied.taskId) {
    const env = await loadTaskEnv(ctx);
    try {
      await deleteTask(env, applied.taskId);
    } catch (error) {
      if (!(error instanceof TaskError)) throw error;
    }
  }
  if (applied.activityId) {
    await ctx.db.crmActivity.updateMany({
      where: { id: applied.activityId, organizationId: ctx.organizationId },
      data: { deletedAt: new Date() },
    });
  }
  if (applied.batchId) {
    const left = await ctx.db.crmFieldHistory.count({ where: { organizationId: ctx.organizationId, batchId: applied.batchId } });
    if (left > 0) await undoBatch(ctx, applied.batchId);
  }
  if (applied.createdKind === "person" && applied.createdId) await trashPeople(ctx, [applied.createdId]);
  if (applied.createdKind === "company" && applied.createdId) await trashCompanies(ctx, [applied.createdId]);
  if (applied.threadId) {
    await ctx.db.crmEmailThread.deleteMany({ where: { id: applied.threadId, organizationId: ctx.organizationId } });
  }
  await ctx.db.crmSuggestion.update({
    where: { id: row.id },
    data: {
      status: "PENDING",
      reviewedById: null,
      reviewedAt: null,
      payload: payload as Prisma.InputJsonObject,
    },
  });
}

/** The label a field key reads as, for a change's row. */
export function changeLabel(kind: TargetKind, field: string, customNames: ReadonlyMap<string, string> = new Map()): string {
  if (field.startsWith("custom.")) return customNames.get(field.slice(7)) ?? "A field";
  if (field === "companyName") return "Company";
  return builtinField(kind, field)?.label ?? field;
}

export { customKey };
