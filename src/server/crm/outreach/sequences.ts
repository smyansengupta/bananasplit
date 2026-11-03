import type { CrmStepKind, Prisma } from "@/generated/prisma/client";
import { renderMerge } from "@/lib/crm/outreach/merge";
import { nextInWindow, readWindow, type SendWindow } from "@/lib/crm/outreach/schedule";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { notifyUser } from "@/server/notifications";

import { CrmError, requireMember, type CrmActor } from "../access";
import { logActivity } from "../activity";
import { emitCrmEvent } from "../events";
import { conflictFor, contactable, mergeValuesFor, queueEmail, sentToday } from "./send";

/**
 * Sequences (docs/features/crm.md, module 5): timed steps (an email, a
 * to-do, a call reminder, a LinkedIn reminder, a text reminder) run by the
 * job queue, one `crm-sequence` job per enrollment step at its time. Email
 * steps go out from the enrolling member's mailbox inside the sequence's
 * send window (the organization's timezone) and under the member's daily
 * cap; the other steps land in that member's follow-up queue and Inbox.
 * A reply, a booking, an unsubscribe or a bounce stops it (inbound.ts,
 * booking.ts, unsubscribe.ts); an out-of-office pauses it until they're
 * back. Follow-up emails answer the first one, in the same thread.
 */

export interface StepInput {
  kind: CrmStepKind;
  delayDays: number;
  delayHours?: number;
  subject?: string | null;
  body?: string | null;
  templateId?: string | null;
  taskTitle?: string | null;
}

export interface SequenceInput {
  name?: string;
  stopOnReply?: boolean;
  stopOnBooking?: boolean;
  sendWindow?: SendWindow;
  steps?: StepInput[];
}

const KINDS: CrmStepKind[] = ["EMAIL", "TASK", "CALL", "TEXT", "LINKEDIN"];

export const STEP_WORDS: Record<CrmStepKind, string> = {
  EMAIL: "Email",
  TASK: "To-do",
  CALL: "Call",
  TEXT: "Text",
  LINKEDIN: "LinkedIn",
};

export async function createSequence(actor: CrmActor, name: string): Promise<{ id: string }> {
  const n = name.trim().slice(0, 120);
  if (!n) throw new CrmError("Give it a name.", ["name"]);
  return actor.db.crmSequence.create({
    data: {
      organizationId: actor.organizationId,
      name: n,
      createdById: actor.userId,
      sendWindow: { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 },
      steps: {
        create: [
          { organizationId: actor.organizationId, sortOrder: 0, kind: "EMAIL", delayDays: 0, subject: "", body: "Hi {{first_name|there}},\n\n\n\n{{my_first_name}}" },
          { organizationId: actor.organizationId, sortOrder: 1, kind: "EMAIL", delayDays: 3, subject: "", body: "Hi {{first_name|there}}, just checking this reached you.\n\n{{my_first_name}}" },
        ],
      },
    },
    select: { id: true },
  });
}

export async function saveSequence(actor: CrmActor, sequenceId: string, input: SequenceInput): Promise<void> {
  const { db, organizationId } = actor;
  const seq = await db.crmSequence.findFirst({ where: { id: sequenceId, organizationId }, select: { id: true } });
  if (!seq) throw new CrmError("That sequence isn't here any more.");
  const data: Prisma.CrmSequenceUpdateInput = {};
  if (input.name !== undefined) {
    const n = input.name.trim().slice(0, 120);
    if (!n) throw new CrmError("Give it a name.", ["name"]);
    data.name = n;
  }
  if (input.stopOnReply !== undefined) data.stopOnReply = input.stopOnReply;
  if (input.stopOnBooking !== undefined) data.stopOnBooking = input.stopOnBooking;
  if (input.sendWindow) data.sendWindow = readWindow(input.sendWindow) as unknown as Prisma.InputJsonObject;
  await db.crmSequence.update({ where: { id: seq.id }, data });
  if (input.steps) {
    if (input.steps.length === 0) throw new CrmError("A sequence needs at least one step.");
    if (input.steps.length > 20) throw new CrmError("Up to 20 steps.");
    const templateIds = input.steps.map((s) => s.templateId).filter((t): t is string => Boolean(t));
    const templates = templateIds.length
      ? await db.crmTemplate.findMany({ where: { organizationId, id: { in: templateIds } }, select: { id: true } })
      : [];
    const known = new Set(templates.map((t) => t.id));
    const rows = input.steps.map((s, i) => {
      if (!KINDS.includes(s.kind)) throw new CrmError("Pick what each step does.");
      const delayDays = Math.min(Math.max(Math.round(Number(s.delayDays) || 0), 0), 365);
      const delayHours = Math.min(Math.max(Math.round(Number(s.delayHours) || 0), 0), 23);
      const templateId = s.templateId && known.has(s.templateId) ? s.templateId : null;
      if (s.kind === "EMAIL" && !templateId && !s.body?.trim()) {
        throw new CrmError(`Step ${i + 1} needs a message or a template.`);
      }
      for (const text of [s.subject ?? "", s.body ?? ""]) {
        const unknown = renderMerge(text, {}).unknown;
        if (unknown.length) throw new CrmError(`Step ${i + 1}: there's no field called {{${unknown[0]}}}.`);
      }
      return {
        organizationId,
        sequenceId: seq.id,
        sortOrder: i,
        kind: s.kind,
        delayDays,
        delayHours,
        templateId,
        subject: s.kind === "EMAIL" ? (s.subject?.trim().slice(0, 300) ?? "") : null,
        body: s.kind === "EMAIL" ? (s.body?.slice(0, 20_000) ?? "") : null,
        taskTitle: s.kind === "EMAIL" ? null : (s.taskTitle?.trim().slice(0, 200) || null),
      };
    });
    await db.crmSequenceStep.deleteMany({ where: { organizationId, sequenceId: seq.id } });
    await db.crmSequenceStep.createMany({ data: rows });
  }
}

export async function setSequenceStatus(actor: CrmActor, sequenceId: string, status: "ON" | "OFF" | "DRAFT"): Promise<void> {
  const { db, organizationId } = actor;
  const seq = await db.crmSequence.findFirst({
    where: { id: sequenceId, organizationId },
    select: { id: true, steps: { select: { id: true } } },
  });
  if (!seq) throw new CrmError("That sequence isn't here any more.");
  if (status === "ON" && seq.steps.length === 0) throw new CrmError("Add a step first.");
  await db.crmSequence.update({ where: { id: seq.id }, data: { status } });
}

export async function archiveSequence(actor: CrmActor, sequenceId: string): Promise<void> {
  const { db, organizationId } = actor;
  const res = await db.crmSequence.updateMany({
    where: { id: sequenceId, organizationId },
    data: { archivedAt: new Date(), status: "OFF" },
  });
  if (res.count === 0) throw new CrmError("That sequence isn't here any more.");
  const active = await db.crmEnrollment.findMany({
    where: { organizationId, sequenceId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { id: true },
  });
  await db.crmEnrollment.updateMany({
    where: { organizationId, id: { in: active.map((a) => a.id) } },
    data: { status: "STOPPED", stopReason: "the sequence was archived", finishedAt: new Date(), nextRunAt: null },
  });
}

async function orgTimezone(db: TxClient, organizationId: string): Promise<string> {
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  return org?.timezone ?? "UTC";
}

function delayMs(step: { delayDays: number; delayHours: number }): number {
  return step.delayDays * 86_400_000 + step.delayHours * 3_600_000;
}

export interface EnrollResult {
  enrolled: number;
  skipped: { personId: string; name: string; reason: string }[];
}

/** Puts people in a sequence, sent from `senderId`'s mailbox (the caller unless given). */
export async function enroll(
  actor: CrmActor,
  sequenceId: string,
  personIds: readonly string[],
  options: { senderId?: string; campaignId?: string | null; confirmConflicts?: boolean } = {},
  now: Date = new Date(),
): Promise<EnrollResult> {
  const { db, organizationId, userId } = actor;
  const ids = [...new Set(personIds)];
  if (ids.length === 0) throw new CrmError("Pick who to add.");
  if (ids.length > 500) throw new CrmError("Up to 500 at a time.");
  const senderId = options.senderId ?? userId;
  if (senderId !== userId) await requireMember(db, organizationId, senderId);
  const seq = await db.crmSequence.findFirst({
    where: { id: sequenceId, organizationId, archivedAt: null },
    select: { id: true, status: true, sendWindow: true, steps: { orderBy: { sortOrder: "asc" }, select: { delayDays: true, delayHours: true } } },
  });
  if (!seq) throw new CrmError("That sequence isn't here any more.");
  if (seq.status !== "ON") throw new CrmError("Turn the sequence on first.");
  const first = seq.steps[0];
  if (!first) throw new CrmError("Add a step first.");
  const tz = await orgTimezone(db, organizationId);
  const window = readWindow(seq.sendWindow);
  const people = await db.crmPerson.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, name: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true },
  });
  const result: EnrollResult = { enrolled: 0, skipped: [] };
  for (const p of people) {
    const can = contactable(p);
    if (!can.ok) {
      result.skipped.push({ personId: p.id, name: p.name, reason: can.reason! });
      continue;
    }
    const already = await db.crmEnrollment.findFirst({
      where: { organizationId, sequenceId: seq.id, personId: p.id, status: { in: ["ACTIVE", "PAUSED"] } },
      select: { id: true },
    });
    if (already) {
      result.skipped.push({ personId: p.id, name: p.name, reason: "Already in it." });
      continue;
    }
    if (!options.confirmConflicts) {
      const conflict = await conflictFor(db, organizationId, p.id, senderId, now);
      if (conflict) {
        const who = await db.user.findUnique({ where: { id: conflict.userId }, select: { name: true } });
        result.skipped.push({ personId: p.id, name: p.name, reason: `${who?.name ?? "Another member"} ${conflict.what}.` });
        continue;
      }
    }
    const runAt = nextInWindow(new Date(now.getTime() + delayMs(first)), window, tz);
    const e = await db.crmEnrollment.create({
      data: { organizationId, sequenceId: seq.id, personId: p.id, senderId, enrolledById: userId, nextStep: 0, nextRunAt: runAt },
      select: { id: true },
    });
    await enqueueJob(db, {
      orgId: organizationId,
      kind: "crm-sequence",
      key: `${e.id}:0`,
      payload: { enrollmentId: e.id, step: 0 },
      runAt,
    });
    result.enrolled++;
  }
  for (const id of ids) {
    if (!people.some((p) => p.id === id)) result.skipped.push({ personId: id, name: "Someone", reason: "Not in the CRM." });
  }
  return result;
}

export async function stopEnrollment(actor: CrmActor, enrollmentId: string): Promise<void> {
  const { db, organizationId } = actor;
  const e = await db.crmEnrollment.findFirst({
    where: { id: enrollmentId, organizationId, status: { in: ["ACTIVE", "PAUSED"] } },
    select: { id: true },
  });
  if (!e) throw new CrmError("It already stopped.");
  await db.crmEnrollment.update({
    where: { id: e.id },
    data: { status: "STOPPED", stopReason: "stopped by hand", finishedAt: new Date(), nextRunAt: null },
  });
  await db.crmEmailMessage.updateMany({
    where: { organizationId, enrollmentId: e.id, status: "QUEUED" },
    data: { status: "FAILED", error: "stopped by hand" },
  });
}

// ---- Running a step (the job) ------------------------------------------------------------

type StepOutcome = "done" | "skipped" | "later" | "finished";

async function runStep(db: TxClient, organizationId: string, enrollmentId: string, stepIndex: number, now: Date): Promise<StepOutcome> {
  const e = await db.crmEnrollment.findFirst({
    where: { id: enrollmentId, organizationId },
    select: {
      id: true,
      status: true,
      nextStep: true,
      nextRunAt: true,
      senderId: true,
      personId: true,
      sequence: {
        select: {
          id: true,
          name: true,
          status: true,
          archivedAt: true,
          sendWindow: true,
          steps: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });
  if (!e || e.nextStep !== stepIndex) return "skipped";
  if (e.status === "PAUSED") {
    // Back from out of office (or resumed): carry on.
    if (e.nextRunAt && e.nextRunAt.getTime() > now.getTime() + 60_000) return "skipped";
    await db.crmEnrollment.update({ where: { id: e.id }, data: { status: "ACTIVE", stopReason: null } });
  } else if (e.status !== "ACTIVE") return "skipped";
  if (e.sequence.archivedAt) return "skipped";
  const tz = await orgTimezone(db, organizationId);
  const window = readWindow(e.sequence.sendWindow);
  const reschedule = async (at: Date) => {
    await db.crmEnrollment.update({ where: { id: e.id }, data: { nextRunAt: at } });
    await enqueueJob(db, {
      orgId: organizationId,
      kind: "crm-sequence",
      key: `${e.id}:${stepIndex}:${at.getTime().toString(36)}`,
      payload: { enrollmentId: e.id, step: stepIndex },
      runAt: at,
      noKick: true,
    });
    return "later" as const;
  };
  // Switched off: wait, checking again tomorrow.
  if (e.sequence.status !== "ON") return reschedule(new Date(now.getTime() + 86_400_000));
  const step = e.sequence.steps[stepIndex];
  if (!step) {
    await finish(db, organizationId, e.id, e.personId);
    return "finished";
  }
  const person = await db.crmPerson.findFirst({
    where: { id: e.personId, organizationId },
    select: { id: true, name: true, phone: true, linkedinUrl: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true },
  });
  const can = person ? contactable(person) : { ok: false, reason: "gone" };
  if (!person || !can.ok) {
    await db.crmEnrollment.update({
      where: { id: e.id },
      data: {
        status: person?.unsubscribedAt ? "UNSUBSCRIBED" : "STOPPED",
        stopReason: can.reason,
        finishedAt: now,
        nextRunAt: null,
      },
    });
    return "skipped";
  }
  const member = await db.membership.findFirst({ where: { organizationId, userId: e.senderId }, select: { userId: true } });
  if (!member) {
    await db.crmEnrollment.update({ where: { id: e.id }, data: { status: "PAUSED", stopReason: "the sender left", nextRunAt: null } });
    return "skipped";
  }
  const inWindow = nextInWindow(now, window, tz);
  if (inWindow.getTime() > now.getTime() + 60_000) return reschedule(inWindow);

  if (step.kind === "EMAIL") {
    const cap = (await db.crmSettings.findUnique({ where: { organizationId }, select: { dailySendCap: true } }))?.dailySendCap ?? 150;
    if ((await sentToday(db, organizationId, e.senderId, now)) >= cap) {
      return reschedule(nextInWindow(new Date(now.getTime() + 86_400_000 - (now.getTime() % 86_400_000)), window, tz));
    }
    const template = step.templateId
      ? await db.crmTemplate.findFirst({ where: { id: step.templateId, organizationId }, select: { subject: true, body: true } })
      : null;
    const values = await mergeValuesFor(db, organizationId, person.id, e.senderId, now);
    // Follow-ups answer the first email of this enrollment, in its thread.
    const prior = await db.crmEmailMessage.findFirst({
      where: { organizationId, enrollmentId: e.id, status: { in: ["SENT", "QUEUED"] } },
      orderBy: { createdAt: "asc" },
      select: { threadId: true, messageIdHeader: true, subject: true },
    });
    const rawSubject = (step.subject?.trim() || template?.subject?.trim() || "").trim();
    const subject = rawSubject
      ? renderMerge(rawSubject, values).text
      : prior?.subject
        ? `Re: ${prior.subject.replace(/^re:\s*/i, "")}`
        : renderMerge(`Hello from {{organization}}`, values).text;
    const body = renderMerge(step.body?.trim() ? step.body : (template?.body ?? ""), values).text;
    await queueEmail(db, {
      organizationId,
      senderId: e.senderId,
      createdById: null,
      personId: person.id,
      subject,
      body,
      templateId: step.templateId,
      enrollmentId: e.id,
      threadId: prior?.threadId ?? null,
      inReplyTo: prior?.messageIdHeader ?? null,
    });
  } else {
    // A to-do for the sender, in their queue and Inbox.
    const what =
      step.taskTitle?.trim() ||
      (step.kind === "CALL"
        ? `Call ${person.name}`
        : step.kind === "LINKEDIN"
          ? `Connect with ${person.name} on LinkedIn`
          : step.kind === "TEXT"
            ? `Text ${person.name}`
            : `Follow up with ${person.name}`);
    await logActivity(db, {
      organizationId,
      kind: "SEQUENCE_STEP",
      subject: what,
      targets: [{ kind: "person", id: person.id }],
      actorId: e.senderId,
      // The sender may close it from their queue (activity edits are their maker's).
      createdById: e.senderId,
      sourceKind: "crm-step",
      sourceId: `${e.id}-${stepIndex}`,
      meta: { open: true, step: step.kind, enrollmentId: e.id, sequence: e.sequence.name, ownerId: e.senderId },
    });
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
    await notifyUser(db, organizationId, e.senderId, {
      type: "CRM_FOLLOW_UP",
      title: what,
      body: `Step ${stepIndex + 1} of ${e.sequence.name}.`,
      linkUrl: org ? `/app/${org.slug}/crm/people/${person.id}` : null,
      dedupeKey: `crm-step:${e.id}:${stepIndex}`,
    });
  }
  await db.crmEnrollment.update({
    where: { id: e.id },
    data: { nextStep: stepIndex + 1, nextRunAt: null },
  });
  const next = e.sequence.steps[stepIndex + 1];
  if (!next) {
    await finish(db, organizationId, e.id, e.personId);
    return "finished";
  }
  const runAt = nextInWindow(new Date(now.getTime() + delayMs(next)), window, tz);
  await db.crmEnrollment.update({ where: { id: e.id }, data: { nextRunAt: runAt } });
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "crm-sequence",
    key: `${e.id}:${stepIndex + 1}`,
    payload: { enrollmentId: e.id, step: stepIndex + 1 },
    runAt,
    noKick: true,
  });
  return "done";
}

async function finish(db: TxClient, organizationId: string, enrollmentId: string, personId: string): Promise<void> {
  await db.crmEnrollment.update({
    where: { id: enrollmentId },
    data: { status: "FINISHED", finishedAt: new Date(), nextRunAt: null },
  });
  await emitCrmEvent(db, organizationId, {
    type: "sequence.finished",
    targetKind: "person",
    targetId: personId,
    sourceId: enrollmentId,
    source: "system",
  });
}

export const crmSequenceJob: JobHandler<{ enrollmentId: string; step: number }> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-sequence needs an organization");
  await withSystemOrgTx(orgId, ({ db }) => runStep(db, orgId, run.payload.enrollmentId, run.payload.step, new Date()));
};

/** Closes an open sequence to-do (logged, or done by hand). */
export async function closeStep(db: TxClient, organizationId: string, activityId: string): Promise<void> {
  const a = await db.crmActivity.findFirst({
    where: { id: activityId, organizationId, kind: "SEQUENCE_STEP" },
    select: { id: true, meta: true },
  });
  if (!a) throw new CrmError("That to-do isn't here any more.");
  const meta = { ...((a.meta ?? {}) as Record<string, unknown>), open: false, doneAt: new Date().toISOString() };
  await db.crmActivity.update({ where: { id: a.id }, data: { meta: meta as Prisma.InputJsonObject } });
}
