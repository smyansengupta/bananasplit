import type { CrmStepKind, Prisma } from "@/generated/prisma/client";
import { crmRecordHref } from "@/lib/crm/href";
import { renderMerge } from "@/lib/crm/outreach/merge";
import { readExtras, withExtras } from "@/lib/crm/outreach/plans";
import { nextInWindow, readWindow, type SendWindow } from "@/lib/crm/outreach/schedule";
import { localDateKey } from "@/lib/tasks/dates";
import { withSystemOrgTx, type SystemContext, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { notifyUser } from "@/server/notifications";
import { createTask, loadTaskEnv } from "@/server/tasks/service";

import { CrmError, crmAccess, requireMember, type CrmActor } from "../access";
import { logActivity } from "../activity";
import { emitCrmEvent } from "../events";
import { queueText } from "../phone/texts";
import { proposeChange } from "../review";
import { actAs } from "../system-actor";
import { conflictsFor, contactable, type Conflict, mergeValuesFor, queueEmail, saveDraft, sentToday, startMayApprove } from "./send";

/**
 * Sequences (docs/features/crm.md, module 5): timed steps (an email, a
 * to-do, a call reminder, a LinkedIn reminder, a text reminder) run by the
 * job queue, one `crm-sequence` job per enrollment step at its time. Email
 * steps go out from the enrolling member's mailbox inside the sequence's
 * send window (the organization's timezone) and under the member's daily
 * cap; a to-do step becomes a real Task for that member (made as the
 * sequence's maker), a text step goes out on the organization's number when
 * they agreed to texts (Phase 5's texting rules), and a call, a LinkedIn
 * note, or a text that can't go waits in the member's follow-up queue and
 * Inbox (calls also on the dialer).
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

/**
 * A running plan is its maker's: someone else changing it (its words, who
 * it's for, who sends it) would change what goes out in the maker's name,
 * so only they, owners, admins and CRM managers may. A plan that isn't
 * running is anyone's to work on.
 */
export async function assertMayEditPlan(
  actor: CrmActor,
  seq: { status: string; createdById: string | null },
): Promise<void> {
  if (seq.status !== "ON" || !seq.createdById || seq.createdById === actor.userId) return;
  if ((await crmAccess(actor)).manager) return;
  throw new CrmError("This plan is running. Only whoever made it, or a CRM manager, can change it now.");
}

export async function saveSequence(actor: CrmActor, sequenceId: string, input: SequenceInput): Promise<void> {
  const { db, organizationId } = actor;
  const seq = await db.crmSequence.findFirst({
    where: { id: sequenceId, organizationId },
    select: { id: true, sendWindow: true, status: true, createdById: true },
  });
  if (!seq) throw new CrmError("That sequence isn't here any more.");
  await assertMayEditPlan(actor, seq);
  const data: Prisma.CrmSequenceUpdateInput = {};
  if (input.name !== undefined) {
    const n = input.name.trim().slice(0, 120);
    if (!n) throw new CrmError("Give it a name.", ["name"]);
    data.name = n;
  }
  if (input.stopOnReply !== undefined) data.stopOnReply = input.stopOnReply;
  if (input.stopOnBooking !== undefined) data.stopOnBooking = input.stopOnBooking;
  // A plan's own settings (who, sender, daily cap) ride along under `plan`: keep them.
  if (input.sendWindow) {
    data.sendWindow = withExtras(readWindow(input.sendWindow), readExtras(seq.sendWindow)) as Prisma.InputJsonObject;
  }
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
        body: s.kind === "EMAIL" ? (s.body?.slice(0, 20_000) ?? "") : s.kind === "TEXT" ? (s.body?.trim().slice(0, 1_000) || null) : null,
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
  const seq = await db.crmSequence.findFirst({
    where: { id: sequenceId, organizationId },
    select: { status: true, createdById: true },
  });
  if (seq) await assertMayEditPlan(actor, seq);
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

/** Emails this sequence has sent (or queued) today, for its own daily cap. */
export async function planSentToday(db: TxClient, organizationId: string, sequenceId: string, now: Date): Promise<number> {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const enrollments = await db.crmEnrollment.findMany({
    where: { organizationId, sequenceId },
    select: { id: true },
    take: 10_000,
  });
  if (enrollments.length === 0) return 0;
  return db.crmEmailMessage.count({
    where: {
      organizationId,
      enrollmentId: { in: enrollments.map((e) => e.id) },
      status: { in: ["QUEUED", "SENT"] },
      createdAt: { gte: start },
    },
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
  options: {
    senderId?: string;
    campaignId?: string | null;
    confirmConflicts?: boolean;
    /**
     * Put in by an automation, not by a person pressing Start: even the
     * first email waits for the sender's OK (enrolledById stays empty).
     */
    byAutomation?: boolean;
  } = {},
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
    select: {
      id: true,
      name: true,
      status: true,
      sendWindow: true,
      createdById: true,
      steps: {
        orderBy: { sortOrder: "asc" },
        select: { kind: true, delayDays: true, delayHours: true, subject: true, body: true, templateId: true },
      },
    },
  });
  if (!seq) throw new CrmError("That sequence isn't here any more.");
  if (seq.status !== "ON") throw new CrmError("Turn the sequence on first.");
  const first = seq.steps[0];
  if (!first) throw new CrmError("Add a step first.");
  const tz = await orgTimezone(db, organizationId);
  const window = readWindow(seq.sendWindow);
  // Pressing Start (or Enroll) is the OK for the first email when it goes as
  // the one pressing it, or they made the plan, or they shape the CRM;
  // otherwise it waits for the sender's own OK (startMayApprove).
  const firstApproved =
    !options.byAutomation &&
    (await startMayApprove(db, organizationId, { enrolledById: userId, senderId, createdById: seq.createdById }));
  const people = await db.crmPerson.findMany({
    where: { organizationId, id: { in: ids } },
    select: { id: true, name: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true },
  });
  const result: EnrollResult = { enrolled: 0, skipped: [] };
  // The checks for everyone at once: who's in it already, and who another
  // member is talking to (with their names).
  const reachable = people.filter((p) => contactable(p).ok).map((p) => p.id);
  const already = new Set(
    reachable.length
      ? (
          await db.crmEnrollment.findMany({
            where: { organizationId, sequenceId: seq.id, personId: { in: reachable }, status: { in: ["ACTIVE", "PAUSED"] } },
            select: { personId: true },
          })
        ).map((e) => e.personId)
      : [],
  );
  const conflicts = options.confirmConflicts
    ? new Map<string, Conflict>()
    : await conflictsFor(db, organizationId, reachable.filter((id) => !already.has(id)), senderId, now);
  const conflictNames = new Map(
    conflicts.size
      ? (
          await db.user.findMany({
            where: { id: { in: [...new Set([...conflicts.values()].map((c) => c.userId))] } },
            select: { id: true, name: true },
          })
        ).map((u) => [u.id, u.name])
      : [],
  );
  for (const p of people) {
    const can = contactable(p);
    if (!can.ok) {
      result.skipped.push({ personId: p.id, name: p.name, reason: can.reason! });
      continue;
    }
    if (already.has(p.id)) {
      result.skipped.push({ personId: p.id, name: p.name, reason: "Already in it." });
      continue;
    }
    const conflict = conflicts.get(p.id);
    if (conflict) {
      result.skipped.push({
        personId: p.id,
        name: p.name,
        reason: `${conflictNames.get(conflict.userId) ?? "Another member"} ${conflict.what}.`,
      });
      continue;
    }
    const runAt = nextInWindow(new Date(now.getTime() + delayMs(first)), window, tz);
    const e = await db.crmEnrollment.create({
      data: {
        organizationId,
        sequenceId: seq.id,
        personId: p.id,
        senderId,
        enrolledById: options.byAutomation ? null : userId,
        nextStep: 0,
        nextRunAt: runAt,
      },
      select: { id: true },
    });
    if (first.kind === "EMAIL" && !options.byAutomation) {
      // The first email is written now, as it was previewed: later edits to
      // the plan or its template don't change what Start approved.
      const mail = await stepEmail(db, organizationId, first, p.id, senderId, now, null);
      if (!firstApproved) {
        // Not theirs to approve: a draft for the sender, and the plan carries
        // on behind it (the next step waits until it's sent or let go).
        await draftStep(db, organizationId, { id: e.id, senderId, sequence: { id: seq.id, name: seq.name } }, 0, p, mail);
        const next = seq.steps[1];
        const at = next
          ? nextInWindow(new Date(now.getTime() + delayMs(next)), window, tz)
          : new Date(now.getTime() + 6 * 3_600_000);
        await db.crmEnrollment.update({ where: { id: e.id }, data: { nextStep: 1, nextRunAt: at } });
        await enqueueJob(db, {
          orgId: organizationId,
          kind: "crm-sequence",
          key: `${e.id}:1`,
          payload: { enrollmentId: e.id, step: 1 },
          runAt: at,
        });
        result.enrolled++;
        continue;
      }
      await freezeFirstEmail(db, organizationId, { enrollmentId: e.id, senderId, approvedById: userId }, p, mail);
    }
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
    where: { organizationId, enrollmentId: e.id, status: { in: ["QUEUED", "SCHEDULED"] } },
    data: { status: "FAILED", error: "stopped by hand" },
  });
}

/** A step's email for one person, merged now: its subject (or "Re:" the first one's), body and template. */
async function stepEmail(
  db: TxClient,
  organizationId: string,
  step: { subject: string | null; body: string | null; templateId: string | null },
  personId: string,
  senderId: string,
  now: Date,
  prior: { subject: string | null } | null,
): Promise<{ subject: string; body: string; templateId: string | null }> {
  const template = step.templateId
    ? await db.crmTemplate.findFirst({ where: { id: step.templateId, organizationId }, select: { subject: true, body: true } })
    : null;
  const values = await mergeValuesFor(db, organizationId, personId, senderId, now);
  const rawSubject = (step.subject?.trim() || template?.subject?.trim() || "").trim();
  const subject = rawSubject
    ? renderMerge(rawSubject, values).text
    : prior?.subject
      ? `Re: ${prior.subject.replace(/^re:\s*/i, "")}`
      : renderMerge(`Hello from {{organization}}`, values).text;
  const body = renderMerge(step.body?.trim() ? step.body : (template?.body ?? ""), values).text;
  return { subject, body, templateId: step.templateId };
}

/**
 * A plan's first email, written and approved when Start was pressed, kept
 * (status SCHEDULED, its own thread, no timeline row) until its step runs:
 * then it's queued exactly as written, under the caps and the send window.
 */
async function freezeFirstEmail(
  db: TxClient,
  organizationId: string,
  e: { enrollmentId: string; senderId: string; approvedById: string },
  person: { id: string; primaryEmail: string | null },
  mail: { subject: string; body: string; templateId: string | null },
): Promise<void> {
  const subject = mail.subject.trim().slice(0, 300);
  const thread = await db.crmEmailThread.create({ data: { organizationId, subject }, select: { id: true } });
  await db.crmEmailMessage.create({
    data: {
      organizationId,
      threadId: thread.id,
      direction: "OUTBOUND",
      status: "SCHEDULED",
      mailbox: "ORG_SENDER",
      mailboxUserId: e.senderId,
      fromAddress: "scheduled",
      toAddresses: person.primaryEmail ? [person.primaryEmail] : [],
      subject,
      bodyText: mail.body.trim().slice(0, 50_000),
      personId: person.id,
      enrollmentId: e.enrollmentId,
      templateId: mail.templateId,
      approval: "start",
      approvedById: e.approvedById,
    },
  });
}

// ---- Running a step (the job) ------------------------------------------------------------

type StepOutcome = "done" | "skipped" | "later" | "finished";

const TEXT_WAITS = "text-waits";

/**
 * Only the first step goes out on its own, and only when a person put them
 * in (Start, Enroll, their campaign share): pressing it was the OK for that
 * first message. Every later email or text, and everything an automation
 * enrolled, waits for the sender (docs/features/crm.md, "Nothing sends
 * unapproved").
 */
export function approvedByStart(e: { enrolledById: string | null }, stepIndex: number): boolean {
  return stepIndex === 0 && e.enrolledById !== null;
}

/** A step's email as a draft in the sender's compose, with a To approve row (and their Inbox line). */
async function draftStep(
  db: TxClient,
  organizationId: string,
  e: { id: string; senderId: string; sequence: { id: string; name: string } },
  stepIndex: number,
  person: { id: string; name: string; primaryEmail: string | null },
  mail: { subject: string; body: string; templateId: string | null },
): Promise<void> {
  const draft = await saveDraft(db, {
    organizationId,
    ownerId: e.senderId,
    personId: person.id,
    subject: mail.subject,
    body: mail.body,
    createdById: null,
    enrollmentId: e.id,
    templateId: mail.templateId,
  });
  await proposeChange(db, {
    organizationId,
    kind: "DRAFT_EMAIL",
    source: "AUTOMATION",
    title: `Email ${person.name}: step ${stepIndex + 1} of ${e.sequence.name}`,
    summary: mail.subject,
    payload: {
      to: person.primaryEmail ? [person.primaryEmail] : [],
      subject: mail.subject,
      body: mail.body,
      why: `Step ${stepIndex + 1} of "${e.sequence.name}". It goes out when you send it.`,
      draftId: draft.draftId,
    },
    target: { kind: "person", id: person.id },
    citation: { kind: "automation", id: e.sequence.id, label: e.sequence.name },
    assigneeId: e.senderId,
    proposedById: null,
  });
}

async function runStep(sys: SystemContext, organizationId: string, enrollmentId: string, stepIndex: number, now: Date): Promise<StepOutcome> {
  const db = sys.db;
  const e = await db.crmEnrollment.findFirst({
    where: { id: enrollmentId, organizationId },
    select: {
      id: true,
      status: true,
      nextStep: true,
      nextRunAt: true,
      senderId: true,
      enrolledById: true,
      personId: true,
      sequence: {
        select: {
          id: true,
          name: true,
          status: true,
          archivedAt: true,
          sendWindow: true,
          createdById: true,
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
  // An earlier step's draft still waits for the sender's OK: the rest waits with it.
  const waiting = await db.crmEmailMessage.findFirst({
    where: { organizationId, enrollmentId: e.id, status: "DRAFT" },
    select: { id: true },
  });
  if (waiting) return reschedule(new Date(now.getTime() + 6 * 3_600_000));
  const step = e.sequence.steps[stepIndex];
  // The last email went out when a person sent it, maybe days after it was
  // drafted: this step's wait counts from then.
  if (step && stepIndex > 0) {
    const last = await db.crmEmailMessage.findFirst({
      where: { organizationId, enrollmentId: e.id, status: { in: ["SENT", "QUEUED"] }, createdById: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, sentAt: true },
    });
    const due = last ? new Date((last.sentAt ?? last.createdAt).getTime() + delayMs(step)) : null;
    if (due && due.getTime() > now.getTime() + 60_000) return reschedule(due);
  }
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
    // The plan's own cap, across everyone sending it.
    const planCap = readExtras(e.sequence.sendWindow).dailyCap;
    if (planCap !== null && (await planSentToday(db, organizationId, e.sequence.id, now)) >= planCap) {
      return reschedule(nextInWindow(new Date(now.getTime() + 86_400_000 - (now.getTime() % 86_400_000)), window, tz));
    }
    // Follow-ups answer the first email of this enrollment, in its thread.
    const prior = await db.crmEmailMessage.findFirst({
      where: { organizationId, enrollmentId: e.id, status: { in: ["SENT", "QUEUED"] } },
      orderBy: { createdAt: "asc" },
      select: { threadId: true, messageIdHeader: true, subject: true },
    });
    // The first email as Start wrote it, when it did; one already drafted,
    // sent or let go needs nothing more written.
    const frozen =
      stepIndex === 0
        ? await db.crmEmailMessage.findFirst({
            where: { organizationId, enrollmentId: e.id },
            orderBy: { createdAt: "asc" },
            select: { id: true, status: true, subject: true, bodyText: true, templateId: true, threadId: true, approvedById: true },
          })
        : null;
    if (!frozen || frozen.status === "SCHEDULED") {
      const mail = frozen
        ? { subject: frozen.subject ?? "", body: frozen.bodyText ?? "", templateId: frozen.templateId }
        : await stepEmail(db, organizationId, step, person.id, e.senderId, now, prior);
      const approved =
        approvedByStart(e, stepIndex) &&
        (!frozen || frozen.approvedById === e.enrolledById) &&
        (await startMayApprove(db, organizationId, {
          enrolledById: e.enrolledById,
          senderId: e.senderId,
          createdById: e.sequence.createdById,
        }));
      if (approved) {
        await queueEmail(db, {
          organizationId,
          senderId: e.senderId,
          createdById: null,
          personId: person.id,
          subject: mail.subject,
          body: mail.body,
          templateId: mail.templateId,
          enrollmentId: e.id,
          threadId: prior?.threadId ?? null,
          inReplyTo: prior?.messageIdHeader ?? null,
          approval: { kind: "start", by: e.enrolledById },
        });
      } else {
        // Nothing goes out without a person: the step's email waits as a draft
        // in the sender's To approve (Today, Power hour, their Inbox).
        await draftStep(db, organizationId, e, stepIndex, person, mail);
      }
      if (frozen) await db.crmEmailThread.deleteMany({ where: { id: frozen.threadId, organizationId } });
    }
  } else {
    // A to-do becomes a real Task (made the way a workflow makes one: as the
    // sequence's maker, else the sender, for the sender, linked to the
    // person); a text goes out on the organization's number (Phase 5) when
    // it can. A call, a LinkedIn note, and anything that couldn't happen on
    // its own waits for the sender in their queue (calls on the dialer too).
    let done = false;
    let note: string | null = null;
    const values = await mergeValuesFor(db, organizationId, person.id, e.senderId, now);
    if (step.kind === "TASK") {
      const maker =
        (e.sequence.createdById ? await actAs(sys, organizationId, e.sequence.createdById) : null) ??
        (await actAs(sys, organizationId, e.senderId));
      if (maker) {
        const env = await loadTaskEnv(maker.orgCtx, now);
        const title = step.taskTitle?.trim() ? renderMerge(step.taskTitle.trim(), values).text : `Follow up with ${person.name}`;
        const made = await createTask(env, {
          title: title.slice(0, 200),
          description: `Step ${stepIndex + 1} of the sequence "${e.sequence.name}".`,
          dueDate: localDateKey(now, tz),
          ...(env.memberIds.has(e.senderId) ? { ownerId: e.senderId } : {}),
          confirmFlagged: true,
        });
        if (made.taskId) {
          await db.itemLink.upsert({
            where: {
              organizationId_fromKind_fromId_toKind_toId: {
                organizationId,
                fromKind: "task",
                fromId: made.taskId,
                toKind: "crm-person",
                toId: person.id,
              },
            },
            create: { organizationId, fromKind: "task", fromId: made.taskId, toKind: "crm-person", toId: person.id, createdById: maker.actor.userId },
            update: {},
          });
          done = true;
        } else {
          note = made.error ?? "the task couldn't be made";
        }
      }
    } else if (
      step.kind === "TEXT" &&
      step.body?.trim() &&
      !(
        approvedByStart(e, stepIndex) &&
        (await startMayApprove(db, organizationId, {
          enrolledById: e.enrolledById,
          senderId: e.senderId,
          createdById: e.sequence.createdById,
        }))
      )
    ) {
      // A later text, or one Start couldn't approve, waits for the sender, its words ready in their queue.
      note = TEXT_WAITS;
    } else if (step.kind === "TEXT" && step.body?.trim()) {
      const sender = await actAs(sys, organizationId, e.senderId);
      if (sender) {
        try {
          await queueText(sender.actor, {
            personId: person.id,
            body: renderMerge(step.body.trim(), values).text,
            approvedById: e.enrolledById,
          });
          done = true;
        } catch (error) {
          if (!(error instanceof CrmError)) throw error;
          note = error.message;
        }
      }
    }
    if (!done) {
      const what =
        (step.taskTitle?.trim() ? renderMerge(step.taskTitle.trim(), values).text : null) ||
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
        body: note === TEXT_WAITS ? "Nothing is texted without you. Send it from their card." : note ? `It couldn't happen on its own: ${note}` : null,
        targets: [{ kind: "person", id: person.id }],
        actorId: e.senderId,
        // The sender may close it from their queue (activity edits are their maker's).
        createdById: e.senderId,
        sourceKind: "crm-step",
        sourceId: `${e.id}-${stepIndex}`,
        meta: {
          open: true,
          step: step.kind,
          enrollmentId: e.id,
          sequence: e.sequence.name,
          ownerId: e.senderId,
          ...(step.kind === "TEXT" && step.body ? { text: renderMerge(step.body, values).text.slice(0, 1000) } : {}),
        },
      });
      const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
      await notifyUser(db, organizationId, e.senderId, {
        type: "CRM_FOLLOW_UP",
        title: what,
        body: `Step ${stepIndex + 1} of ${e.sequence.name}.`,
        // A call waits on the dialer; anything else on their page.
        linkUrl: org ? (step.kind === "CALL" ? `/app/${org.slug}/crm/calls` : crmRecordHref(org.slug, "person", person.id)) : null,
        dedupeKey: `crm-step:${e.id}:${stepIndex}`,
      });
    }
  }
  await db.crmEnrollment.update({
    where: { id: e.id },
    data: { nextStep: stepIndex + 1, nextRunAt: null },
  });
  const next = e.sequence.steps[stepIndex + 1];
  if (!next) {
    // The last email waits for its OK: the enrollment stays open (a reply
    // still withdraws the draft) and finishes once it has gone.
    const pending = await db.crmEmailMessage.findFirst({
      where: { organizationId, enrollmentId: e.id, status: "DRAFT" },
      select: { id: true },
    });
    if (pending) {
      const at = new Date(now.getTime() + 6 * 3_600_000);
      await db.crmEnrollment.update({ where: { id: e.id }, data: { nextRunAt: at } });
      await enqueueJob(db, {
        orgId: organizationId,
        kind: "crm-sequence",
        key: `${e.id}:${stepIndex + 1}:${at.getTime().toString(36)}`,
        payload: { enrollmentId: e.id, step: stepIndex + 1 },
        runAt: at,
        noKick: true,
      });
      return "done";
    }
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
  // The step runs as its sender (the audit trail names them; a to-do is made the way a member makes one).
  const who = await withSystemOrgTx(orgId, ({ db }) =>
    db.crmEnrollment.findFirst({ where: { id: run.payload.enrollmentId, organizationId: orgId }, select: { senderId: true } }),
  );
  if (!who) return;
  await withSystemOrgTx(orgId, { userId: who.senderId }, (sys) => runStep(sys, orgId, run.payload.enrollmentId, run.payload.step, new Date()));
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
