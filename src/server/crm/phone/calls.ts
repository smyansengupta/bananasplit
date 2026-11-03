import type { CrmCallStatus, CrmDirection, Prisma } from "@/generated/prisma/client";
import { CALL_OUTCOMES, formatDuration, outcomeLabel, toE164 } from "@/lib/crm/phone";
import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

import { CrmError, type CrmActor } from "../access";
import { logActivity, type ActivityTarget } from "../activity";
import { emitCrmEvent } from "../events";
import { closeStep } from "../outreach/sequences";
import { readPhoneStatus } from "./connection";

/**
 * Calls (docs/features/crm.md module 5, "Calls"): a tel: link and a call
 * log on day one; with Telnyx or Twilio connected, the browser softphone
 * and the power dialer place them, and the provider's events fill in the
 * status and length. Either way every call is one CrmCall row and one CALL
 * row on the timeline (sourceKind "call", sourceId the call's id, so the
 * provider's events and the member's outcome update the same row), and
 * `call.logged` is emitted for workflows and webhooks.
 *
 * Recording is never on by default: the organization can switch it off for
 * good (CrmSettings.phone.recording "never"), and otherwise it starts only
 * after the all-party notice has played to everyone on the call
 * (CrmCall.recordingConsent).
 */

export interface CallTargets {
  personId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
}

/** The person, company and item a call is about, checked to be this organization's. */
async function targetsOf(db: TxClient, organizationId: string, t: CallTargets): Promise<ActivityTarget[]> {
  const out: ActivityTarget[] = [];
  if (t.personId) {
    const p = await db.crmPerson.findFirst({
      where: { id: t.personId, organizationId },
      select: { id: true, companyId: true },
    });
    if (!p) throw new CrmError("That person isn't in the CRM any more.");
    out.push({ kind: "person", id: p.id });
    if (p.companyId && !t.companyId) out.push({ kind: "company", id: p.companyId });
  }
  if (t.companyId) {
    const c = await db.crmCompany.findFirst({ where: { id: t.companyId, organizationId }, select: { id: true } });
    if (!c) throw new CrmError("That company isn't in the CRM any more.");
    out.push({ kind: "company", id: c.id });
  }
  if (t.dealId) {
    const d = await db.crmDeal.findFirst({ where: { id: t.dealId, organizationId }, select: { id: true } });
    if (!d) throw new CrmError("That item isn't in the CRM any more.");
    out.push({ kind: "deal", id: d.id });
  }
  if (out.length === 0) throw new CrmError("Pick who the call was with.");
  return out;
}

export interface LogCallInput extends CallTargets {
  /** Finishing a call the softphone or dialer placed. */
  callId?: string | null;
  outcome: string;
  notes?: string | null;
  durationSec?: number | null;
  direction?: CrmDirection;
  occurredAt?: Date | string | null;
  /** Follow up again on this day (the person's next follow-up). */
  followUpAt?: Date | string | null;
  /** The sequence's call step this call does (its open row in the follow-up queue closes). */
  stepId?: string | null;
}

function subjectOf(outcome: string | null, direction: CrmDirection): string {
  const word = outcomeLabel(outcome);
  if (!outcome || word === "Call") return direction === "INBOUND" ? "Call in" : "Call";
  return direction === "INBOUND" ? `Call in: ${word.toLowerCase()}` : `Call: ${word.toLowerCase()}`;
}

/** The timeline row's body: notes, then the summary and next steps once there are any. */
export function callBody(call: {
  notes: string | null;
  summary: string | null;
  durationSec: number | null;
  recordingKey?: string | null;
  transcript?: string | null;
}): string | null {
  const parts: string[] = [];
  if (call.notes) parts.push(call.notes);
  if (call.summary) parts.push(call.summary);
  const facts = [
    call.durationSec ? formatDuration(call.durationSec) : null,
    call.recordingKey ? "recorded" : null,
    call.transcript ? "written out" : null,
  ].filter(Boolean);
  if (facts.length) parts.push(`(${facts.join(", ")})`);
  return parts.length ? parts.join("\n\n") : null;
}

/** Writes (or rewrites) the call's timeline row and remembers it on the call. */
export async function syncCallActivity(
  db: TxClient,
  organizationId: string,
  callId: string,
  extraTargets: readonly ActivityTarget[] = [],
): Promise<string | null> {
  const call = await db.crmCall.findFirst({ where: { id: callId, organizationId } });
  if (!call) return null;
  const existing = call.activityId
    ? await db.crmActivityTarget.findMany({
        where: { organizationId, activityId: call.activityId },
        select: { targetKind: true, targetId: true },
      })
    : [];
  const targets: ActivityTarget[] = [
    ...(call.personId ? [{ kind: "person" as const, id: call.personId }] : []),
    ...existing.map((t) => ({ kind: t.targetKind as ActivityTarget["kind"], id: t.targetId })),
    ...extraTargets,
  ];
  if (targets.length === 0) return null;
  const activityId = await logActivity(db, {
    organizationId,
    kind: "CALL",
    direction: call.direction,
    subject: subjectOf(call.outcome, call.direction),
    body: callBody(call),
    occurredAt: call.startedAt,
    actorId: call.userId,
    createdById: call.userId,
    sourceKind: "call",
    sourceId: call.id,
    targets,
    meta: {
      callId: call.id,
      outcome: call.outcome,
      durationSec: call.durationSec,
      provider: call.provider,
      recorded: Boolean(call.recordingKey),
      transcribed: Boolean(call.transcript),
    },
  });
  if (call.activityId !== activityId) {
    await db.crmCall.update({ where: { id: call.id }, data: { activityId } });
  }
  return activityId;
}

async function emitLogged(db: TxClient, organizationId: string, targets: readonly ActivityTarget[], callId: string, userId: string | null) {
  const first = targets.find((t) => t.kind === "person") ?? targets[0];
  if (!first) return;
  await emitCrmEvent(db, organizationId, {
    type: "call.logged",
    targetKind: first.kind,
    targetId: first.id,
    userId,
    sourceId: callId,
    source: "user",
  });
}

/** Logs a call by hand, or finishes one the softphone placed, with its outcome and notes. */
export async function logCall(actor: CrmActor, input: LogCallInput): Promise<{ callId: string; activityId: string | null }> {
  const { db, organizationId, userId } = actor;
  if (!CALL_OUTCOMES.some((o) => o.id === input.outcome)) throw new CrmError("Pick how the call went.");
  const notes = input.notes?.trim().slice(0, 10_000) || null;
  const duration =
    input.durationSec === null || input.durationSec === undefined
      ? null
      : Number.isInteger(input.durationSec) && input.durationSec >= 0 && input.durationSec < 86_400
        ? input.durationSec
        : (() => {
            throw new CrmError("Check how long the call was.");
          })();
  const at = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 60_000) throw new CrmError("Pick when the call was.");
  const targets = await targetsOf(db, organizationId, input);
  const personId = targets.find((t) => t.kind === "person")?.id ?? null;

  let callId: string;
  if (input.callId) {
    const call = await db.crmCall.findFirst({
      where: { id: input.callId, organizationId },
      select: { id: true, userId: true, durationSec: true, personId: true },
    });
    if (!call) throw new CrmError("That call isn't here any more.");
    // The timeline row is the caller's (its RLS lets only its author change it).
    if (call.userId && call.userId !== userId) throw new CrmError("Only the member who made the call can log how it went.");
    await db.crmCall.update({
      where: { id: call.id },
      data: {
        outcome: input.outcome,
        notes,
        durationSec: duration ?? call.durationSec,
        personId: call.personId ?? personId,
      },
    });
    callId = call.id;
  } else {
    const person = personId
      ? await db.crmPerson.findFirst({ where: { id: personId, organizationId }, select: { phone: true } })
      : null;
    const created = await db.crmCall.create({
      data: {
        organizationId,
        personId,
        userId,
        direction: input.direction ?? "OUTBOUND",
        status: "LOGGED",
        provider: "manual",
        toNumber: (input.direction ?? "OUTBOUND") === "OUTBOUND" ? (toE164(person?.phone) ?? null) : null,
        startedAt: at,
        durationSec: duration,
        outcome: input.outcome,
        notes,
      },
      select: { id: true },
    });
    callId = created.id;
  }
  const activityId = await syncCallActivity(db, organizationId, callId, targets);
  if (personId && input.followUpAt) {
    const when = new Date(input.followUpAt);
    if (Number.isNaN(when.getTime())) throw new CrmError("Pick a real follow-up day.");
    await db.crmPerson.updateMany({ where: { id: personId, organizationId }, data: { nextFollowUpAt: when, updatedById: userId } });
  } else if (personId && input.outcome === "connected") {
    // Reached them: a follow-up that was due is done.
    await db.crmPerson.updateMany({
      where: { id: personId, organizationId, nextFollowUpAt: { lte: new Date() } },
      data: { nextFollowUpAt: null, updatedById: userId },
    });
  }
  if (input.stepId) {
    // The step may have been closed by hand already: the call still counts.
    const open = await db.crmActivity.findFirst({
      where: { id: input.stepId, organizationId, kind: "SEQUENCE_STEP" },
      select: { id: true },
    });
    if (open) await closeStep(db, organizationId, open.id);
  }
  await emitLogged(db, organizationId, targets, callId, userId);
  return { callId, activityId };
}

// ---- The softphone and the dialer ------------------------------------------------------

export interface StartedCall {
  callId: string;
  provider: "telnyx" | "twilio";
  to: string;
  from: string;
  /** Recording will start after the notice (the member asked and the organization allows it). */
  record: boolean;
}

/**
 * A call the browser is about to place: the row first (QUEUED), so the
 * provider's events and the member's outcome land on it. Refuses people
 * marked do-not-contact and numbers that can't be dialled.
 */
export async function startCall(actor: CrmActor, input: { personId: string; record?: boolean; dealId?: string | null }): Promise<StartedCall> {
  const { db, organizationId, userId } = actor;
  const status = await readPhoneStatus(db, organizationId);
  if (!status.active) throw new CrmError("Connect Telnyx or Twilio on Integrations and apps to call from here.");
  const prov = status.active === "telnyx" ? status.telnyx : status.twilio;
  if (!prov.softphone) throw new CrmError("Calling from the browser isn't set up yet. An admin finishes it on Integrations and apps.");
  if (!status.number) throw new CrmError("Pick the number calls go out from on Integrations and apps.");
  const person = await db.crmPerson.findFirst({
    where: { id: input.personId, organizationId, deletedAt: null },
    select: { id: true, phone: true, doNotContact: true },
  });
  if (!person) throw new CrmError("That person isn't in the CRM any more.");
  if (person.doNotContact) throw new CrmError("They asked not to be contacted.");
  const to = toE164(person.phone);
  if (!to) throw new CrmError("Add their number first, with its country code.");
  const record = Boolean(input.record) && status.settings.recording !== "never";
  const call = await db.crmCall.create({
    data: {
      organizationId,
      personId: person.id,
      userId,
      direction: "OUTBOUND",
      status: "QUEUED",
      provider: status.active,
      fromNumber: status.number,
      toNumber: to,
      startedAt: new Date(),
      // Consent is set when the notice has played, never here.
      recordingConsent: false,
    },
    select: { id: true },
  });
  return { callId: call.id, provider: status.active, to, from: status.number, record };
}

const STATUS_FROM_PROVIDER: Record<string, CrmCallStatus> = {
  queued: "QUEUED",
  initiated: "QUEUED",
  ringing: "RINGING",
  "in-progress": "IN_PROGRESS",
  answered: "IN_PROGRESS",
  completed: "COMPLETED",
  hangup: "COMPLETED",
  "no-answer": "NO_ANSWER",
  busy: "BUSY",
  failed: "FAILED",
  canceled: "NO_ANSWER",
};

export function callStatusFrom(providerStatus: string): CrmCallStatus | null {
  return STATUS_FROM_PROVIDER[providerStatus.toLowerCase()] ?? null;
}

/** The outcome a finished call gets until the member says otherwise. */
function defaultOutcome(status: CrmCallStatus, durationSec: number | null): string | null {
  if (status === "NO_ANSWER") return "no-answer";
  if (status === "BUSY") return "busy";
  if (status === "COMPLETED" && (durationSec ?? 0) > 0) return "connected";
  return null;
}

const FINAL: ReadonlySet<CrmCallStatus> = new Set(["COMPLETED", "NO_ANSWER", "BUSY", "FAILED"]);

/**
 * A provider's event about a call (service path, the organization's
 * context): status and length, and the provider's call id the first time.
 * A finished call lands on the timeline even if the member never saves an
 * outcome.
 */
export async function applyCallEvent(
  db: TxClient,
  organizationId: string,
  input: { callId?: string | null; providerCallId?: string | null; status: CrmCallStatus | null; durationSec?: number | null },
): Promise<string | null> {
  const call = input.callId
    ? await db.crmCall.findFirst({ where: { id: input.callId, organizationId } })
    : input.providerCallId
      ? await db.crmCall.findFirst({ where: { organizationId, providerCallId: input.providerCallId } })
      : null;
  if (!call) return null;
  const data: Prisma.CrmCallUpdateInput = {};
  if (input.providerCallId && !call.providerCallId) data.providerCallId = input.providerCallId;
  if (input.status && !FINAL.has(call.status)) data.status = input.status;
  if (typeof input.durationSec === "number" && input.durationSec >= 0) data.durationSec = Math.round(input.durationSec);
  const status = (data.status as CrmCallStatus | undefined) ?? call.status;
  if (FINAL.has(status) && !call.outcome) {
    const outcome = defaultOutcome(status, (data.durationSec as number | undefined) ?? call.durationSec);
    if (outcome) data.outcome = outcome;
  }
  if (Object.keys(data).length > 0) await db.crmCall.update({ where: { id: call.id }, data });
  if (FINAL.has(status) && (!call.activityId || data.durationSec !== undefined || data.outcome !== undefined)) {
    const first = !call.activityId;
    await syncCallActivity(db, organizationId, call.id);
    if (first && call.personId) {
      await emitLogged(db, organizationId, [{ kind: "person", id: call.personId }], call.id, call.userId);
    }
  }
  return call.id;
}

/** The notice has played to everyone on the call: recording may start. */
export async function markNoticePlayed(db: TxClient, organizationId: string, callId: string): Promise<boolean> {
  const status = await readPhoneStatus(db, organizationId);
  if (status.settings.recording === "never") return false;
  const r = await db.crmCall.updateMany({
    where: { id: callId, organizationId },
    data: { recordingConsent: true },
  });
  return r.count > 0;
}

/** A recording is ready at the provider: fetch it and store it (a job; no network here). */
export async function recordingReady(
  db: TxClient,
  organizationId: string,
  input: { callId?: string | null; providerCallId?: string | null; recordingId: string },
): Promise<void> {
  const call = input.callId
    ? await db.crmCall.findFirst({ where: { id: input.callId, organizationId }, select: { id: true, recordingConsent: true } })
    : await db.crmCall.findFirst({
        where: { organizationId, providerCallId: input.providerCallId ?? "" },
        select: { id: true, recordingConsent: true },
      });
  // A recording made without the notice is never kept.
  if (!call || !call.recordingConsent) return;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(input.recordingId)) return;
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "crm-call-audio",
    key: call.id,
    payload: { callId: call.id, recordingId: input.recordingId },
  });
}
