import { can } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/crm/fields";
import { addDaysToKey, localDateKey } from "@/lib/tasks/dates";
import {
  ACTION_INFO,
  fewestPick,
  renderMessage,
  resolveValue,
  roundRobinPick,
  type RunLogEntry,
  type WorkflowAction,
} from "@/lib/crm/workflows";
import { absoluteAppUrl } from "@/lib/app-url";
import { writeFinanceAuditLog } from "@/lib/finance/audit";
import type { OrgContext } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { notifyUsers } from "@/server/notifications";
import { createTask, loadTaskEnv, type TaskEnv } from "@/server/tasks/service";
import { AUTOMATION_WINDOW, nextInWindow } from "@/lib/crm/outreach/schedule";

import type { CrmActor } from "./access";
import { CrmError } from "./access";
import { createDeal, moveDeal, updateDeal } from "./deals";
import { updateCompany } from "./companies";
import { effectiveOwnerId, type RoleOwner } from "./owners";
import { updatePerson } from "./people";
import { inviteLink } from "./outreach/campaigns";
import { contactable, queueEmail, renderFor, saveDraft } from "./outreach/send";
import { enroll } from "./outreach/sequences";
import { proposeChange } from "./review";
import type { WorkflowTarget } from "./workflow-target";
import { targetPath } from "./workflow-target";

/**
 * What each workflow step does (docs/features/crm.md, module 6). Every step
 * runs as the workflow's acting member (whoever made it, while they're
 * still a manager; else an owner), with source "automation", so field
 * history says an automation did it and the change never sets off the same
 * workflow again (events.ts). A dry run reads what it needs and says what
 * would happen, writing nothing. Steps that leave Bananasplit (Slack,
 * Discord, webhooks) only queue a crm-workflow-call job here: network calls
 * never happen inside a transaction.
 *
 * Three steps go through outreach (Phase 2), one function each:
 * - sendTemplateAction: the template, merged by outreach's renderer, sent
 *   through queueEmail and the crm-send job from the owner's name (so
 *   do-not-contact, unsubscribes, bounces, the daily cap and waking hours
 *   apply); a step set to "review" leaves an unsent draft in the owner's
 *   compose and a Review suggestion instead.
 * - enrollInSequenceAction: outreach's enroll, from the owner's mailbox.
 * - inviteToEventAction: a member joins the event's invitees; anyone else
 *   gets its RSVP link by email the same way (or a draft, set to review).
 */

export interface ActionContext {
  actor: CrmActor;
  /** The member context the Tasks service takes (null on a dry run). */
  orgCtx: OrgContext | null;
  orgSlug: string;
  workflow: { id: string; name: string; turn: number };
  runId: string | null;
  index: number;
  target: WorkflowTarget;
  roles: ReadonlyMap<string, RoleOwner>;
  now: Date;
  tz: string;
  dryRun: boolean;
  /** Loaded once per run when a step makes tasks. */
  taskEnv?: TaskEnv;
}

const ok = (action: WorkflowAction, detail: string, extra: Partial<RunLogEntry> = {}): RunLogEntry => ({
  action: action.type,
  ok: true,
  detail,
  ...extra,
});
const skip = (action: WorkflowAction, detail: string): RunLogEntry => ({ action: action.type, ok: false, detail });

async function memberIds(ctx: ActionContext): Promise<string[]> {
  const rows = await ctx.actor.db.membership.findMany({
    where: { organizationId: ctx.actor.organizationId },
    select: { userId: true },
    orderBy: { joinedAt: "asc" },
  });
  return rows.map((r) => r.userId);
}

async function memberName(ctx: ActionContext, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const u = await ctx.actor.db.user.findUnique({ where: { id: userId }, select: { name: true } });
  return u?.name ?? null;
}

function ownerOf(ctx: ActionContext): string | null {
  return effectiveOwnerId(ctx.target, ctx.roles);
}

/** The message's merge values. */
async function mergeValues(ctx: ActionContext): Promise<Record<string, string | number | null>> {
  return {
    ...ctx.target.merge,
    owner: await memberName(ctx, ownerOf(ctx)),
    link: absoluteAppUrl(targetPath(ctx.orgSlug, ctx.target.kind, ctx.target.id)),
    days: typeof ctx.target.values.daysInStage === "number" ? ctx.target.values.daysInStage : null,
  };
}

async function render(ctx: ActionContext, template: string): Promise<string> {
  return renderMessage(template, await mergeValues(ctx));
}

const LINK_KIND = { person: "crm-person", company: "crm-company", deal: "crm-deal" } as const;

async function linkToTarget(ctx: ActionContext, fromKind: string, fromId: string): Promise<void> {
  const { db, organizationId, userId } = ctx.actor;
  const links: { kind: string; id: string }[] = [{ kind: LINK_KIND[ctx.target.kind], id: ctx.target.id }];
  if (ctx.target.kind === "deal" && ctx.target.companyId) links.push({ kind: "crm-company", id: ctx.target.companyId });
  for (const l of links) {
    await db.itemLink.upsert({
      where: {
        organizationId_fromKind_fromId_toKind_toId: { organizationId, fromKind, fromId, toKind: l.kind, toId: l.id },
      },
      create: { organizationId, fromKind, fromId, toKind: l.kind, toId: l.id, createdById: userId },
      update: {},
    });
  }
}

async function taskEnv(ctx: ActionContext): Promise<TaskEnv> {
  if (!ctx.orgCtx) throw new CrmError("Tasks need a member to make them.");
  if (!ctx.taskEnv) ctx.taskEnv = await loadTaskEnv(ctx.orgCtx, ctx.now);
  return ctx.taskEnv;
}

async function makeTask(
  ctx: ActionContext,
  input: { title: string; dueKey?: string | null; ownerId?: string | null; parentTaskId?: string; type?: "EPIC" | "TASK"; priority?: "HIGH" | "MEDIUM" | "LOW"; description?: string },
): Promise<string> {
  const env = await taskEnv(ctx);
  const ownerId = input.ownerId && env.memberIds.has(input.ownerId) ? input.ownerId : null;
  const result = await createTask(env, {
    title: input.title.slice(0, 200),
    ...(input.description ? { description: input.description } : {}),
    ...(input.dueKey ? { dueDate: input.dueKey } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.priority ? { priority: input.priority } : {}),
    confirmFlagged: true,
  });
  if (result.error || !result.taskId) throw new CrmError(result.error ?? "The task couldn't be made.");
  return result.taskId;
}

function dueKey(ctx: ActionContext, days: number | undefined): string | null {
  if (days === undefined) return null;
  return addDaysToKey(localDateKey(ctx.now, ctx.tz), days);
}

/** The person a message goes to: the person, an item's main person, a company's closest contact. */
function recipientOf(ctx: ActionContext): string | null {
  return ctx.target.personIds[0] ?? null;
}

// ---- Outreach (Phase 2's send path) ---------------------------------------------------

export interface OutreachResult {
  ok: boolean;
  detail: string;
}

/** Who an automation's email goes out as: the record's owner while a member, else the acting member. */
async function senderFor(ctx: ActionContext): Promise<string> {
  const owner = ownerOf(ctx);
  if (owner && (await memberIds(ctx)).includes(owner)) return owner;
  return ctx.actor.userId;
}

/** Null when it's waking hours in the organization's timezone; else when they start. */
function whenToSend(ctx: ActionContext): Date | null {
  const at = nextInWindow(ctx.now, AUTOMATION_WINDOW, ctx.tz);
  return at.getTime() > ctx.now.getTime() + 60_000 ? at : null;
}

/**
 * An automation's email, through outreach's one send path (queueEmail and
 * the crm-send job, so do-not-contact, unsubscribes, bounces, the daily cap
 * and waking hours all apply), or, with `review`, an unsent draft in the
 * sender's compose with a Review suggestion to send it.
 */
async function automationEmail(
  ctx: ActionContext,
  input: { personId: string; name: string; subject: string; body: string; templateId?: string | null; review: boolean; title: string },
): Promise<OutreachResult> {
  const { db, organizationId } = ctx.actor;
  const senderId = await senderFor(ctx);
  let rendered: { subject: string; body: string };
  try {
    rendered = await renderFor(db, organizationId, input.personId, senderId, { subject: input.subject, body: input.body });
  } catch (error) {
    if (error instanceof CrmError) return { ok: false, detail: error.message };
    throw error;
  }
  if (input.review) {
    if (ctx.dryRun) return { ok: true, detail: `Would draft "${rendered.subject}" to ${input.name} for review.` };
    const draft = await saveDraft(db, {
      organizationId,
      ownerId: senderId,
      personId: input.personId,
      subject: rendered.subject,
      body: rendered.body,
      createdById: null,
    });
    const person = await db.crmPerson.findFirst({ where: { id: input.personId, organizationId }, select: { primaryEmail: true } });
    await proposeChange(db, {
      organizationId,
      kind: "DRAFT_EMAIL",
      source: "AUTOMATION",
      title: input.title,
      summary: rendered.subject,
      payload: {
        to: person?.primaryEmail ? [person.primaryEmail] : [],
        subject: rendered.subject,
        body: rendered.body,
        why: `From the automation "${ctx.workflow.name}".`,
        draftId: draft.draftId,
      },
      target: { kind: "person", id: input.personId },
      citation: { kind: "automation", id: ctx.workflow.id, label: ctx.workflow.name },
      assigneeId: senderId,
      proposedById: null,
    });
    return { ok: true, detail: `Drafted "${rendered.subject}" to ${input.name}; it waits in Review.` };
  }
  const later = whenToSend(ctx);
  if (ctx.dryRun) {
    return { ok: true, detail: `Would send "${rendered.subject}" to ${input.name}${later ? " at 8 AM" : ""}.` };
  }
  try {
    await queueEmail(db, {
      organizationId,
      senderId,
      createdById: null,
      personId: input.personId,
      subject: rendered.subject,
      body: rendered.body,
      templateId: input.templateId ?? null,
      workflowId: ctx.workflow.id,
      scheduledFor: later,
    });
  } catch (error) {
    if (error instanceof CrmError) return { ok: false, detail: error.message };
    throw error;
  }
  return { ok: true, detail: later ? `"${rendered.subject}" goes to ${input.name} at 8 AM.` : `Sending "${rendered.subject}" to ${input.name}.` };
}

/** The person, and why they can't be emailed (null when they can). */
async function reachable(ctx: ActionContext, personId: string) {
  const { db, organizationId } = ctx.actor;
  const person = await db.crmPerson.findFirst({
    where: { id: personId, organizationId },
    select: { id: true, name: true, userId: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true },
  });
  if (!person) return { person: null, reason: "The person isn't in the CRM any more." };
  const can = contactable(person);
  return { person, reason: can.ok ? null : `${person.name}: ${can.reason!.charAt(0).toLowerCase()}${can.reason!.slice(1)}` };
}

/** Sends a template to a person (or, set to review, drafts it for the owner). */
export async function sendTemplateAction(
  ctx: ActionContext,
  input: { templateId: string; personId: string; review?: boolean },
): Promise<OutreachResult> {
  const { db, organizationId } = ctx.actor;
  const template = await db.crmTemplate.findFirst({
    where: { id: input.templateId, organizationId, archivedAt: null },
    select: { id: true, name: true, subject: true, body: true },
  });
  if (!template) return { ok: false, detail: "The template isn't there any more." };
  const r = await reachable(ctx, input.personId);
  if (!r.person) return { ok: false, detail: r.reason ?? "They're gone." };
  if (r.reason) return { ok: false, detail: r.reason };
  return automationEmail(ctx, {
    personId: r.person.id,
    name: r.person.name,
    subject: template.subject?.trim() || template.name,
    body: template.body,
    templateId: template.id,
    review: input.review === true,
    title: `Send "${template.name}" to ${r.person.name}`,
  });
}

/** Enrolls a person in a sequence through outreach's own enroll (the owner's mailbox sends it). */
export async function enrollInSequenceAction(
  ctx: ActionContext,
  input: { sequenceId: string; personId: string },
): Promise<OutreachResult> {
  const { db, organizationId } = ctx.actor;
  const sequence = await db.crmSequence.findFirst({
    where: { id: input.sequenceId, organizationId, archivedAt: null },
    select: { id: true, name: true, status: true, steps: { select: { id: true }, take: 1 } },
  });
  if (!sequence) return { ok: false, detail: "The sequence isn't there any more." };
  if (sequence.status !== "ON") return { ok: false, detail: `"${sequence.name}" is switched off.` };
  if (sequence.steps.length === 0) return { ok: false, detail: `"${sequence.name}" has no steps yet.` };
  const r = await reachable(ctx, input.personId);
  if (!r.person) return { ok: false, detail: r.reason ?? "They're gone." };
  if (r.reason) return { ok: false, detail: r.reason };
  const active = await db.crmEnrollment.findFirst({
    where: { organizationId, sequenceId: sequence.id, personId: r.person.id, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { id: true },
  });
  if (active) return { ok: true, detail: `${r.person.name} is already in "${sequence.name}".` };
  if (ctx.dryRun) return { ok: true, detail: `Would enroll ${r.person.name} in "${sequence.name}".` };
  const result = await enroll(ctx.actor, sequence.id, [r.person.id], { senderId: await senderFor(ctx) }, ctx.now);
  if (result.enrolled === 0) {
    return { ok: false, detail: `${r.person.name} wasn't enrolled: ${result.skipped[0]?.reason ?? "they can't be emailed."}` };
  }
  return { ok: true, detail: `Enrolled ${r.person.name} in "${sequence.name}".` };
}

/** Invites a person to an event: a member joins its invitees; anyone else gets its RSVP link by email. */
export async function inviteToEventAction(
  ctx: ActionContext,
  input: { eventId: string; personId: string; review?: boolean },
): Promise<OutreachResult> {
  const { db, organizationId } = ctx.actor;
  const event = await db.event.findFirst({
    where: { id: input.eventId, organizationId, deletedAt: null, mergedIntoId: null },
    select: { id: true, title: true, startsAt: true },
  });
  if (!event) return { ok: false, detail: "The event isn't there any more." };
  if (event.startsAt < ctx.now) return { ok: false, detail: `"${event.title}" has already started.` };
  const r = await reachable(ctx, input.personId);
  if (!r.person) return { ok: false, detail: r.reason ?? "They're gone." };
  const person = r.person;
  const member = person.userId
    ? await db.membership.findUnique({
        where: { userId_organizationId: { userId: person.userId, organizationId } },
        select: { userId: true },
      })
    : null;
  if (member) {
    if (ctx.dryRun) return { ok: true, detail: `Would invite ${person.name} to "${event.title}".` };
    await db.eventAttendee.upsert({
      where: { eventId_userId: { eventId: event.id, userId: member.userId } },
      create: { organizationId, eventId: event.id, userId: member.userId, rsvp: "PENDING" },
      update: {},
    });
    await notifyUsers(db, organizationId, [member.userId], {
      type: "EVENT_INVITE",
      title: `You're invited to ${event.title}`,
      linkUrl: `/app/${ctx.orgSlug}/meetings/${event.id}`,
      actorId: ctx.actor.userId,
      dedupeKey: `crm-invite:${event.id}:${member.userId}`,
    });
    return { ok: true, detail: `Invited ${person.name} to "${event.title}".` };
  }
  if (r.reason) return { ok: false, detail: r.reason };
  const link = await inviteLink(db, organizationId, "", event.id);
  if (!link) return { ok: false, detail: `"${event.title}" has no RSVP page to send. Turn on RSVPs for it first.` };
  const when = event.startsAt.toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: ctx.tz,
  });
  return automationEmail(ctx, {
    personId: person.id,
    name: person.name,
    subject: `You're invited: ${event.title}`,
    body: `Hi {{first_name|there}},\n\nWe'd love to see you at ${event.title}, ${when}.\n\nSay you're coming here: ${link}\n\n{{my_first_name}}\n{{organization}}`,
    review: input.review === true,
    title: `Invite ${person.name} to ${event.title}`,
  });
}

// ---- Field changes ------------------------------------------------------------------

function settableInput(kind: WorkflowTarget["kind"], field: string, value: unknown): Record<string, unknown> {
  if (field.startsWith("custom.")) return { custom: { [field.slice(7)]: value } };
  if (field === "owner") return { ownerId: value || null };
  if (field === "doNotContact") return { doNotContact: value === true || value === "true" || value === "yes" };
  if (field === "keepInTouchDays") return { keepInTouchDays: value === null || value === "" ? null : Number(value) };
  if (kind === "deal" && field === "amount") return { amount: value };
  return { [field]: value };
}

async function setField(ctx: ActionContext, field: string, raw: string | number | boolean | null): Promise<string> {
  const value = resolveValue(raw, ctx.now);
  const opts = { trusted: true, source: "automation" as const };
  const input = settableInput(ctx.target.kind, field, value);
  if (ctx.target.kind === "person") await updatePerson(ctx.actor, ctx.target.id, input, opts);
  else if (ctx.target.kind === "company") await updateCompany(ctx.actor, ctx.target.id, input, opts);
  else await updateDeal(ctx.actor, ctx.target.id, input, opts);
  return value === null || value === "" ? "emptied" : `set to ${String(value)}`;
}

// ---- Steps --------------------------------------------------------------------------

export async function runAction(ctx: ActionContext, action: WorkflowAction): Promise<RunLogEntry> {
  const { db, organizationId } = ctx.actor;
  const owner = ownerOf(ctx);
  switch (action.type) {
    case "task.create": {
      const p = action.params;
      const title = await render(ctx, p.title);
      const assignee = p.assignTo === "owner" ? owner : p.assignTo === "member" ? (p.userId ?? null) : null;
      const due = dueKey(ctx, p.dueInDays);
      if (ctx.dryRun) {
        return ok(action, `Would create "${title}"${due ? ` due ${due}` : ""}${assignee ? ` for ${(await memberName(ctx, assignee)) ?? "a member"}` : ""}.`);
      }
      const taskId = await makeTask(ctx, { title, dueKey: due, ownerId: assignee, priority: p.priority });
      await linkToTarget(ctx, "task", taskId);
      return ok(action, `Created the task "${title}".`);
    }
    case "field.set": {
      const { field, value } = action.params;
      if (field === "stage" || field === "stageId") return skip(action, "Use Move to a stage for stages.");
      if (ctx.dryRun) return ok(action, `Would set ${field} to ${String(resolveValue(value, ctx.now) ?? "empty")}.`);
      return ok(action, `${field} ${await setField(ctx, field, value)}.`);
    }
    case "stage.move": {
      if (ctx.target.kind !== "deal") return skip(action, "Only items move stage.");
      const stage = await db.crmStage.findFirst({
        where: { id: action.params.stageId, organizationId, pipelineId: ctx.target.pipelineId ?? "" },
        select: { id: true, name: true },
      });
      if (!stage) return skip(action, "That stage isn't in this item's pipeline.");
      if (ctx.target.match.stageId === stage.id) return ok(action, `Already in ${stage.name}.`);
      if (ctx.dryRun) return ok(action, `Would move it to ${stage.name}.`);
      const moved = await moveDeal(ctx.actor, ctx.target.id, { stageId: stage.id }, { trusted: true, source: "automation" });
      if (moved.needs) return skip(action, `${stage.name} needs ${moved.needs.labels.join(", ")} first.`);
      return ok(action, `Moved it to ${stage.name}.`);
    }
    case "owner.assign": {
      const p = action.params;
      const members = new Set(await memberIds(ctx));
      const pool = (p.userIds.length > 0 ? p.userIds : [...members]).filter((u) => members.has(u));
      let pick: string | null = null;
      if (p.mode === "member") pick = p.userId && members.has(p.userId) ? p.userId : null;
      else if (p.mode === "round_robin") pick = roundRobinPick(pool, ctx.workflow.turn);
      else {
        const counts = new Map<string, number>();
        const rows =
          ctx.target.kind === "deal"
            ? await db.crmDeal.groupBy({
                by: ["ownerId"],
                where: { organizationId, deletedAt: null, closedAt: null, ownerId: { in: pool } },
                _count: { _all: true },
              })
            : ctx.target.kind === "person"
              ? await db.crmPerson.groupBy({
                  by: ["ownerId"],
                  where: { organizationId, deletedAt: null, status: "ACTIVE", ownerId: { in: pool } },
                  _count: { _all: true },
                })
              : await db.crmCompany.groupBy({
                  by: ["ownerId"],
                  where: { organizationId, deletedAt: null, ownerId: { in: pool } },
                  _count: { _all: true },
                });
        for (const r of rows) if (r.ownerId) counts.set(r.ownerId, r._count._all);
        pick = fewestPick(pool, counts);
      }
      if (!pick) return skip(action, "Nobody to assign it to.");
      const name = (await memberName(ctx, pick)) ?? "a member";
      if (ctx.target.ownerId === pick && !ctx.target.ownerRoleKey) return ok(action, `Already owned by ${name}.`);
      if (ctx.dryRun) return ok(action, `Would assign it to ${name}.`);
      await setField(ctx, "owner", pick);
      if (pick !== ctx.actor.userId) {
        await notifyUsers(db, organizationId, [pick], {
          type: "CRM_ASSIGNED",
          title: `${ctx.target.name} is yours now`,
          body: `Assigned by the automation "${ctx.workflow.name}".`,
          linkUrl: targetPath(ctx.orgSlug, ctx.target.kind, ctx.target.id),
          actorId: ctx.actor.userId,
        });
      }
      return ok(action, `Assigned it to ${name}.`);
    }
    case "deal.create": {
      if (ctx.target.kind === "deal") return skip(action, "It's already an item.");
      const pipeline = await db.crmPipeline.findFirst({
        where: { id: action.params.pipelineId, organizationId, archivedAt: null },
        select: { id: true, name: true, itemNoun: true },
      });
      if (!pipeline) return skip(action, "That pipeline isn't there any more.");
      const personId = ctx.target.kind === "person" ? ctx.target.id : null;
      const existing = await db.crmDeal.findFirst({
        where: {
          organizationId,
          pipelineId: pipeline.id,
          deletedAt: null,
          closedAt: null,
          ...(personId ? { people: { some: { personId } } } : { companyId: ctx.target.id }),
        },
        select: { id: true },
      });
      if (existing) return ok(action, `Already has an open ${pipeline.itemNoun} in ${pipeline.name}.`);
      const title = action.params.title ? await render(ctx, action.params.title) : ctx.target.name;
      if (ctx.dryRun) return ok(action, `Would add "${title}" to ${pipeline.name}.`);
      await createDeal(
        ctx.actor,
        {
          pipelineId: pipeline.id,
          stageId: action.params.stageId,
          title,
          primaryPersonId: personId,
          companyId: ctx.target.kind === "company" ? ctx.target.id : (ctx.target.companyId ?? (personId ? ((await db.crmPerson.findFirst({ where: { id: personId, organizationId }, select: { companyId: true } }))?.companyId ?? null) : null)),
          ...(owner ? { ownerId: owner } : {}),
          source: "automation",
        },
        { trusted: true, source: "automation" },
      );
      return ok(action, `Added "${title}" to ${pipeline.name}.`);
    }
    case "template.send": {
      const personId = recipientOf(ctx);
      if (!personId) return skip(action, "Nobody to send it to.");
      const r = await sendTemplateAction(ctx, { templateId: action.params.templateId, personId, review: action.params.review });
      return r.ok ? ok(action, r.detail) : skip(action, r.detail);
    }
    case "sequence.enroll": {
      const personId = recipientOf(ctx);
      if (!personId) return skip(action, "Nobody to enroll.");
      const r = await enrollInSequenceAction(ctx, { sequenceId: action.params.sequenceId, personId });
      return r.ok ? ok(action, r.detail) : skip(action, r.detail);
    }
    case "event.invite": {
      const personId = recipientOf(ctx);
      if (!personId) return skip(action, "Nobody to invite.");
      const r = await inviteToEventAction(ctx, { eventId: action.params.eventId, personId, review: action.params.review });
      return r.ok ? ok(action, r.detail) : skip(action, r.detail);
    }
    case "notify": {
      const p = action.params;
      let to: string[] = [];
      if (p.to === "owner") to = owner ? [owner] : [];
      else if (p.to === "member") to = p.userId ? [p.userId] : [];
      else {
        const settings = await db.crmSettings.findUnique({ where: { organizationId }, select: { managerIds: true } });
        const admins = await db.membership.findMany({
          where: { organizationId, role: { in: ["OWNER", "ADMIN"] } },
          select: { userId: true },
        });
        to = [...new Set([...(settings?.managerIds ?? []), ...admins.map((a) => a.userId)])];
      }
      const members = new Set(await memberIds(ctx));
      to = to.filter((u) => members.has(u));
      if (to.length === 0) return skip(action, "Nobody to tell: it has no owner.");
      const message = await render(ctx, p.message);
      if (ctx.dryRun) return ok(action, `Would tell ${to.length === 1 ? ((await memberName(ctx, to[0]!)) ?? "a member") : `${to.length} people`}: "${message}"`);
      await notifyUsers(db, organizationId, to, {
        type: "CRM_FOLLOW_UP",
        title: message,
        body: `From the automation "${ctx.workflow.name}".`,
        linkUrl: targetPath(ctx.orgSlug, ctx.target.kind, ctx.target.id),
        actorId: null,
      });
      return ok(action, `Told ${to.length === 1 ? ((await memberName(ctx, to[0]!)) ?? "a member") : `${to.length} people`}.`);
    }
    case "slack.post":
    case "discord.post":
    case "webhook.call": {
      const where = ACTION_INFO[action.type].label.replace(/^(Post to|Call) /, "");
      if (ctx.dryRun) return ok(action, `Would ${action.type === "webhook.call" ? "call the webhook" : `post to ${where}`}.`);
      if (!ctx.runId) return skip(action, "No run to report back to.");
      await enqueueJob(db, {
        orgId: organizationId,
        kind: "crm-workflow-call",
        key: `${ctx.runId}:${ctx.index}`,
        payload: { runId: ctx.runId, index: ctx.index },
      });
      return ok(action, "Queued.", { queued: true });
    }
    case "finance.create": {
      const p = action.params;
      const cents =
        p.amountFrom === "item" ? (ctx.target.amountCents ?? null) : p.amount !== undefined ? Math.round(p.amount * 100) : null;
      if (cents === null || cents <= 0) return skip(action, "There's no amount to record.");
      const finance = can({ role: ctx.actor.role }, "finance.manage");
      if (p.direction === "IN" && !finance) {
        return skip(action, "Only a treasurer's automation can record money in. Ask one to save this automation.");
      }
      const description = await render(ctx, p.description);
      if (ctx.dryRun) return ok(action, `Would record ${formatMoney(cents)} ${p.direction === "IN" ? "in" : "out"}: "${description}".`);
      const period = await db.budgetPeriod.findFirst({
        where: { organizationId, isActive: true },
        select: { id: true },
      });
      if (!period) return skip(action, "Finance isn't set up yet: open Finance once first.");
      const created = await db.transaction.create({
        data: {
          organizationId,
          budgetPeriodId: period.id,
          direction: p.direction,
          kind: p.direction === "IN" ? "OTHER_INCOME" : "EXPENSE",
          amountCents: cents,
          description: description.slice(0, 200),
          counterparty: (ctx.target.merge.company as string | null) ?? null,
          occurredAt: ctx.now,
          submittedById: ctx.actor.userId,
          // Money out waits as a draft for a treasurer; money in is a treasurer's own record.
          status: p.direction === "OUT" ? "DRAFT" : "NOT_APPLICABLE",
        },
      });
      await writeFinanceAuditLog(db, {
        organizationId,
        transactionId: created.id,
        action: "CREATE",
        after: { ...created, via: `crm-workflow:${ctx.workflow.id}` },
      });
      await db.itemLink.create({
        data: {
          organizationId,
          fromKind: "transaction",
          fromId: created.id,
          toKind: LINK_KIND[ctx.target.kind],
          toId: ctx.target.id,
          createdById: ctx.actor.userId,
        },
      });
      return ok(action, `Recorded ${formatMoney(cents)} ${p.direction === "IN" ? "in" : "out"} in Finance${p.direction === "OUT" ? " as a draft" : ""}.`);
    }
    case "project.start": {
      const p = action.params;
      const name = await render(ctx, p.name);
      const lead = p.ownerFrom === "owner" ? owner : (p.userId ?? null);
      const due = dueKey(ctx, p.dueInDays);
      const files =
        p.linkFiles
          ? await db.itemLink.findMany({
              where: {
                organizationId,
                OR: [
                  { fromKind: "file", toKind: LINK_KIND[ctx.target.kind], toId: ctx.target.id },
                  { toKind: "file", fromKind: LINK_KIND[ctx.target.kind], fromId: ctx.target.id },
                ],
              },
              select: { fromKind: true, fromId: true, toId: true },
              take: 50,
            })
          : [];
      if (ctx.dryRun) {
        return ok(action, `Would start the project "${name}" with ${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"}${files.length ? ` and ${files.length} file${files.length === 1 ? "" : "s"}` : ""}.`);
      }
      const linked = await db.itemLink.findMany({
        where: { organizationId, fromKind: "task", toKind: LINK_KIND[ctx.target.kind], toId: ctx.target.id },
        select: { fromId: true },
        take: 200,
      });
      if (linked.length > 0) {
        const epic = await db.task.findFirst({
          where: { id: { in: linked.map((l) => l.fromId) }, organizationId, type: "EPIC", deletedAt: null, title: name.slice(0, 200) },
          select: { id: true },
        });
        if (epic) return ok(action, `The project "${name}" is already started.`);
      }
      const epicId = await makeTask(ctx, {
        title: name,
        type: "EPIC",
        ownerId: lead,
        dueKey: due,
        description: `Started by the automation "${ctx.workflow.name}" from ${absoluteAppUrl(targetPath(ctx.orgSlug, ctx.target.kind, ctx.target.id))}`,
      });
      for (const t of p.tasks) {
        await makeTask(ctx, { title: await render(ctx, t), parentTaskId: epicId, ownerId: lead, dueKey: due });
      }
      await linkToTarget(ctx, "task", epicId);
      for (const f of files) {
        const fileId = f.fromKind === "file" ? f.fromId : f.toId;
        await db.itemLink.upsert({
          where: {
            organizationId_fromKind_fromId_toKind_toId: { organizationId, fromKind: "task", fromId: epicId, toKind: "file", toId: fileId },
          },
          create: { organizationId, fromKind: "task", fromId: epicId, toKind: "file", toId: fileId, createdById: ctx.actor.userId },
          update: {},
        });
      }
      return ok(action, `Started the project "${name}" with ${p.tasks.length} task${p.tasks.length === 1 ? "" : "s"}${files.length ? ` and ${files.length} file${files.length === 1 ? "" : "s"}` : ""}.`);
    }
  }
}
