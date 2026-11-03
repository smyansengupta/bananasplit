import { formatMoney } from "@/lib/crm/fields";
import { normalizeEmail } from "@/lib/crm/dedupe";
import { renderMerge, sinceWords, textToHtml, type MergeValues } from "@/lib/crm/outreach/merge";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { PermanentJobError, type JobHandler } from "@/server/jobs/types";
import { EmailConfigError } from "@/server/email/transport";

import { CrmError, type CrmActor } from "../access";
import { logActivity, type ActivityTarget } from "../activity";
import { costOf, meterUseIn, underCap } from "../spend";
import { messageIdFor, replyAddress, sendFromMailbox, type MailPurpose, type SentEmail } from "./mailbox";
import { clickUrl, mailToken, oneClickUrl, pixelUrl, unsubscribeUrl } from "./tokens";

/**
 * Outgoing CRM email (docs/features/crm.md, module 5): queueEmail writes
 * the message (QUEUED) and its pending timeline row in the caller's
 * transaction and enqueues `crm-send`; the job renders it (tracking pixel,
 * tracked links, the member's signature, an unsubscribe footer on
 * sequence, campaign and bulk mail), sends it through sendFromMailbox
 * outside any transaction, and marks it SENT with its timeline row.
 *
 * Do-not-contact, unsubscribes and bounces are checked when it's queued
 * AND again just before it goes, so a person who opts out in between gets
 * nothing. Sequence and campaign mail counts toward the sender's daily cap
 * (CrmSettings.dailySendCap); past it, the send waits for tomorrow.
 */

export const SOURCE_KIND = "crm-email";

export interface Contactable {
  ok: boolean;
  reason: string | null;
}

/** May anyone in the organization email this person? */
export function contactable(p: {
  doNotContact: boolean;
  unsubscribedAt: Date | null;
  consent: unknown;
  primaryEmail?: string | null;
  deletedAt?: Date | null;
}): Contactable {
  if (p.deletedAt) return { ok: false, reason: "They're in the trash." };
  if (p.doNotContact) return { ok: false, reason: "They asked not to be contacted." };
  if (p.unsubscribedAt) return { ok: false, reason: "They unsubscribed." };
  const consent = (p.consent && typeof p.consent === "object" ? p.consent : {}) as { email?: { bounced?: boolean } };
  if (consent.email?.bounced) return { ok: false, reason: "Mail to them bounced. Check their address." };
  if (p.primaryEmail !== undefined && !p.primaryEmail) return { ok: false, reason: "They have no email address." };
  return { ok: true, reason: null };
}

/** What the merge fields read for one person, sent by one member. */
export async function mergeValuesFor(
  db: TxClient,
  organizationId: string,
  personId: string,
  senderId: string | null,
  now: Date = new Date(),
): Promise<MergeValues> {
  const p = await db.crmPerson.findFirst({
    where: { id: personId, organizationId },
    select: {
      name: true,
      firstName: true,
      lastName: true,
      primaryEmail: true,
      title: true,
      lastContactedAt: true,
      company: { select: { name: true, website: true, domain: true } },
    },
  });
  if (!p) return {};
  const links = await db.crmActivityTarget.findMany({
    where: { organizationId, targetKind: "person", targetId: personId },
    orderBy: { occurredAt: "desc" },
    take: 200,
    select: { activityId: true },
  });
  const history = links.length
    ? await db.crmActivity.findMany({
        where: {
          organizationId,
          id: { in: links.map((l) => l.activityId) },
          deletedAt: null,
          kind: { in: ["CHECK_IN", "RSVP", "PAYMENT"] },
          occurredAt: { lte: now },
        },
        orderBy: { occurredAt: "desc" },
        select: { kind: true, occurredAt: true, meta: true, subject: true },
      })
    : [];
  const checkIns = history.filter((h) => h.kind === "CHECK_IN");
  const lastEvent = checkIns[0] ?? history.find((h) => h.kind === "RSVP");
  const eventId = lastEvent ? ((lastEvent.meta ?? {}) as { eventId?: string }).eventId : undefined;
  const event = eventId
    ? await db.event.findFirst({ where: { id: eventId, organizationId }, select: { title: true, startsAt: true } })
    : null;
  const gift = history.find((h) => h.kind === "PAYMENT");
  const giftCents = gift ? Number(((gift.meta ?? {}) as { amountCents?: number }).amountCents ?? 0) : 0;
  const sender = senderId ? await db.user.findUnique({ where: { id: senderId }, select: { name: true } }) : null;
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  return {
    first_name: p.firstName ?? p.name.split(" ")[0],
    last_name: p.lastName,
    full_name: p.name,
    email: p.primaryEmail,
    title: p.title,
    company: p.company?.name,
    company_website: p.company?.website ?? p.company?.domain,
    last_event: event?.title ?? null,
    last_event_date: event ? event.startsAt.toLocaleDateString("en-US", { month: "long", day: "numeric" }) : null,
    events_attended: checkIns.length ? String(checkIns.length) : null,
    last_contacted: sinceWords(p.lastContactedAt, now),
    last_gift: giftCents > 0 ? formatMoney(giftCents) : null,
    my_name: sender?.name ?? null,
    my_first_name: sender?.name?.split(" ")[0] ?? null,
    organization: org?.name ?? null,
  };
}

export interface QueueEmailInput {
  organizationId: string;
  /** The member it goes out as (their mailbox, their name). */
  senderId: string;
  /** Who queued it: the caller on the member path (RLS), null from a job. */
  createdById: string | null;
  personId: string;
  subject: string;
  /** Plain text, merge fields already filled. */
  body: string;
  /** Other records it's about (the item it was written from, the company). */
  extraTargets?: ActivityTarget[];
  templateId?: string | null;
  campaignId?: string | null;
  enrollmentId?: string | null;
  /** Sent by an automation (a workflow step): counts toward the daily cap and carries the unsubscribe footer. */
  workflowId?: string | null;
  /** Continue a thread: its id and the Message-ID to answer. */
  threadId?: string | null;
  inReplyTo?: string | null;
  scheduledFor?: Date | null;
  /** Open and click tracking (default on). */
  track?: boolean;
  /** Don't enqueue a job per message (bulk sends in batches). */
  noJob?: boolean;
}

/** Writes one QUEUED message and its pending timeline row; returns its id. */
export async function queueEmail(db: TxClient, input: QueueEmailInput): Promise<{ messageId: string }> {
  const { organizationId } = input;
  const person = await db.crmPerson.findFirst({
    where: { id: input.personId, organizationId },
    select: {
      id: true,
      name: true,
      primaryEmail: true,
      companyId: true,
      doNotContact: true,
      unsubscribedAt: true,
      consent: true,
      deletedAt: true,
    },
  });
  if (!person) throw new CrmError("That person isn't in the CRM any more.");
  const can = contactable(person);
  if (!can.ok) throw new CrmError(can.reason!);
  const subject = input.subject.trim().slice(0, 300);
  const body = input.body.trim().slice(0, 50_000);
  if (!subject) throw new CrmError("Give it a subject.", ["subject"]);
  if (!body) throw new CrmError("Write the message.", ["body"]);
  const thread = input.threadId
    ? await db.crmEmailThread.findFirst({ where: { id: input.threadId, organizationId }, select: { id: true } })
    : null;
  const threadId =
    thread?.id ?? (await db.crmEmailThread.create({ data: { organizationId, subject }, select: { id: true } })).id;
  const token = input.track === false ? null : mailToken();
  const message = await db.crmEmailMessage.create({
    data: {
      organizationId,
      threadId,
      direction: "OUTBOUND",
      status: "QUEUED",
      mailbox: "ORG_SENDER",
      mailboxUserId: input.senderId,
      fromAddress: "pending",
      toAddresses: [person.primaryEmail!],
      subject,
      bodyText: body,
      trackingToken: token ?? mailToken(),
      inReplyTo: input.inReplyTo ?? null,
      templateId: input.templateId ?? null,
      campaignId: input.campaignId ?? null,
      enrollmentId: input.enrollmentId ?? null,
      workflowId: input.workflowId ?? null,
      personId: person.id,
      scheduledFor: input.scheduledFor ?? null,
      createdById: input.createdById,
      error: input.track === false ? "untracked" : null,
    },
    select: { id: true },
  });
  await db.crmEmailMessage.update({
    where: { id: message.id },
    data: { messageIdHeader: messageIdFor(message.id) },
  });
  const targets: ActivityTarget[] = [
    { kind: "person", id: person.id },
    ...(person.companyId ? [{ kind: "company" as const, id: person.companyId }] : []),
    ...(input.extraTargets ?? []),
  ];
  const activityId = await logActivity(db, {
    organizationId,
    kind: "SYSTEM",
    subject: `Email waiting to send: ${subject}`,
    targets,
    occurredAt: input.scheduledFor ?? new Date(),
    actorId: input.senderId,
    createdById: input.createdById,
    sourceKind: SOURCE_KIND,
    sourceId: message.id,
    privateToId: input.senderId,
    meta: { status: "queued" },
  });
  await db.crmEmailThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date() } });
  await db.crmEmailMessage.update({ where: { id: message.id }, data: { activityId } });
  if (!input.noJob) {
    await enqueueJob(db, {
      orgId: organizationId,
      kind: "crm-send",
      key: message.id,
      payload: { messageId: message.id },
      runAt: input.scheduledFor ?? undefined,
    });
  }
  return { messageId: message.id };
}

/** Renders merge fields for one person; refuses a typo'd field. */
export async function renderFor(
  db: TxClient,
  organizationId: string,
  personId: string,
  senderId: string,
  text: { subject: string; body: string },
): Promise<{ subject: string; body: string; missing: string[] }> {
  const values = await mergeValuesFor(db, organizationId, personId, senderId);
  const s = renderMerge(text.subject, values);
  const b = renderMerge(text.body, values);
  const unknown = [...new Set([...s.unknown, ...b.unknown])];
  if (unknown.length) throw new CrmError(`There's no field called ${unknown.map((u) => `{{${u}}}`).join(", ")}.`);
  return { subject: s.text, body: b.text, missing: [...new Set([...s.missing, ...b.missing])] };
}

// ---- Never step on each other ------------------------------------------------------------

export interface Conflict {
  userId: string;
  what: string;
  at: Date | null;
}

/** Another member is actively talking to them: in touch in the last two weeks, a sequence of theirs, or their campaign share. */
export async function conflictFor(
  db: TxClient,
  organizationId: string,
  personId: string,
  viewerId: string,
  now: Date = new Date(),
): Promise<Conflict | null> {
  const since = new Date(now.getTime() - 14 * 86_400_000);
  const enrollment = await db.crmEnrollment.findFirst({
    where: { organizationId, personId, status: { in: ["ACTIVE", "PAUSED"] }, senderId: { not: viewerId } },
    select: { senderId: true, startedAt: true, sequence: { select: { name: true } } },
  });
  if (enrollment) {
    return { userId: enrollment.senderId, what: `has them in the sequence "${enrollment.sequence.name}"`, at: enrollment.startedAt };
  }
  const target = await db.crmCampaignTarget.findFirst({
    where: {
      organizationId,
      personId,
      assigneeId: { not: viewerId },
      status: { in: ["TODO", "CONTACTED", "REPLIED"] },
      campaign: { status: "ACTIVE" },
    },
    select: { assigneeId: true, updatedAt: true, campaign: { select: { name: true } } },
  });
  if (target?.assigneeId) {
    return { userId: target.assigneeId, what: `has them in their share of "${target.campaign.name}"`, at: target.updatedAt };
  }
  const links = await db.crmActivityTarget.findMany({
    where: { organizationId, targetKind: "person", targetId: personId, occurredAt: { gte: since, lte: now } },
    orderBy: { occurredAt: "desc" },
    take: 30,
    select: { activityId: true },
  });
  if (links.length) {
    const recent = await db.crmActivity.findFirst({
      where: {
        organizationId,
        id: { in: links.map((l) => l.activityId) },
        deletedAt: null,
        kind: { in: ["EMAIL", "CALL", "MEETING", "TEXT"] },
        actorId: { not: null, notIn: [viewerId] },
      },
      orderBy: { occurredAt: "desc" },
      select: { actorId: true, occurredAt: true, kind: true },
    });
    if (recent?.actorId) {
      const words: Record<string, string> = { EMAIL: "emailed them", CALL: "called them", MEETING: "met them", TEXT: "texted them" };
      return { userId: recent.actorId, what: words[recent.kind] ?? "was in touch", at: recent.occurredAt };
    }
  }
  return null;
}

// ---- Compose (the member path) ------------------------------------------------------------

export interface ComposeInput {
  personId: string;
  subject: string;
  body: string;
  templateId?: string | null;
  /** The record it's written from, besides the person. */
  dealId?: string | null;
  /** Answer a thread (a reply waiting in the queue). */
  replyToMessageId?: string | null;
  /** ISO time to send later. */
  sendAt?: string | null;
  /** They saw who else is talking to this person and still want to send. */
  confirmConflict?: boolean;
  track?: boolean;
  /** The unsent draft this was written from (an AI draft): it goes away once this is queued. */
  draftId?: string | null;
}

// ---- Drafts (unsent, waiting in compose) ----------------------------------------------------

export interface DraftView {
  id: string;
  personId: string | null;
  subject: string;
  body: string;
  createdAt: Date;
  /** Who it's for (the member whose compose it opens in). */
  ownerId: string | null;
}

/**
 * Saves an unsent draft for one person, in one member's compose: a DRAFT
 * CrmEmailMessage in its own thread. Nothing ever sends it; the member opens
 * it in compose, previews it and sends it (composeEmail with draftId).
 */
export async function saveDraft(
  db: TxClient,
  input: { organizationId: string; ownerId: string; personId: string; subject: string; body: string; createdById: string | null },
): Promise<{ draftId: string; threadId: string }> {
  const person = await db.crmPerson.findFirst({
    where: { id: input.personId, organizationId: input.organizationId },
    select: { id: true, primaryEmail: true },
  });
  if (!person) throw new CrmError("That person isn't in the CRM any more.");
  const subject = input.subject.trim().slice(0, 300);
  const thread = await db.crmEmailThread.create({
    data: { organizationId: input.organizationId, subject },
    select: { id: true },
  });
  const draft = await db.crmEmailMessage.create({
    data: {
      organizationId: input.organizationId,
      threadId: thread.id,
      direction: "OUTBOUND",
      status: "DRAFT",
      mailbox: "ORG_SENDER",
      mailboxUserId: input.ownerId,
      fromAddress: "draft",
      toAddresses: person.primaryEmail ? [person.primaryEmail] : [],
      subject,
      bodyText: input.body.trim().slice(0, 50_000),
      personId: person.id,
      createdById: input.createdById,
    },
    select: { id: true },
  });
  return { draftId: draft.id, threadId: thread.id };
}

/** The unsent drafts waiting for a person (the viewer's own, under RLS). */
export async function draftsFor(db: TxClient, organizationId: string, personId: string, ownerId: string): Promise<DraftView[]> {
  const rows = await db.crmEmailMessage.findMany({
    where: { organizationId, status: "DRAFT", personId, mailboxUserId: ownerId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, subject: true, bodyText: true, createdAt: true, mailboxUserId: true },
  });
  return rows.map((r) => ({
    id: r.id,
    personId,
    subject: r.subject ?? "",
    body: r.bodyText ?? "",
    createdAt: r.createdAt,
    ownerId: r.mailboxUserId,
  }));
}

/**
 * Throws a draft away. Its own thread goes with it when the caller may
 * delete threads (owners, admins and CRM managers, under RLS); otherwise,
 * or when the thread has other messages, the draft is marked discarded and
 * leaves compose all the same.
 */
export async function discardDraft(db: TxClient, organizationId: string, draftId: string): Promise<void> {
  const d = await db.crmEmailMessage.findFirst({
    where: { id: draftId, organizationId, status: "DRAFT" },
    select: { id: true, threadId: true },
  });
  if (!d) return;
  const others = await db.crmEmailMessage.count({ where: { organizationId, threadId: d.threadId, id: { not: d.id } } });
  if (others === 0 && (await dropThread(db, organizationId, d.threadId))) return;
  await db.crmEmailMessage.updateMany({ where: { id: d.id, organizationId }, data: { status: "FAILED", error: "discarded" } });
}

/**
 * Deletes a thread and its messages if the caller may (owners, admins and
 * CRM managers; a member's delete matches no row under RLS). True when it
 * went.
 */
export async function dropThread(db: TxClient, organizationId: string, threadId: string): Promise<boolean> {
  const { count } = await db.crmEmailThread.deleteMany({ where: { id: threadId, organizationId } });
  return count > 0;
}

export type ComposeResult = { messageId: string } | { conflict: Conflict & { name: string } };

/** A member's one-to-one email to one person. */
export async function composeEmail(actor: CrmActor, input: ComposeInput): Promise<ComposeResult> {
  const { db, organizationId, userId } = actor;
  if (!input.confirmConflict) {
    const conflict = await conflictFor(db, organizationId, input.personId, userId);
    if (conflict) {
      const who = await db.user.findUnique({ where: { id: conflict.userId }, select: { name: true } });
      return { conflict: { ...conflict, name: who?.name ?? "Another member" } };
    }
  }
  const rendered = await renderFor(db, organizationId, input.personId, userId, input);
  let threadId: string | null = null;
  let inReplyTo: string | null = null;
  if (input.replyToMessageId) {
    const prior = await db.crmEmailMessage.findFirst({
      where: { id: input.replyToMessageId, organizationId },
      select: { threadId: true, messageIdHeader: true },
    });
    threadId = prior?.threadId ?? null;
    inReplyTo = prior?.messageIdHeader ?? null;
  }
  const extra: ActivityTarget[] = [];
  if (input.dealId) {
    const deal = await db.crmDeal.findFirst({ where: { id: input.dealId, organizationId }, select: { id: true } });
    if (deal) extra.push({ kind: "deal", id: deal.id });
  }
  let sendAt: Date | null = null;
  if (input.sendAt) {
    sendAt = new Date(input.sendAt);
    if (Number.isNaN(sendAt.getTime())) throw new CrmError("Pick a real time.");
    if (sendAt.getTime() < Date.now()) sendAt = null;
  }
  const queued = await queueEmail(db, {
    organizationId,
    senderId: userId,
    createdById: userId,
    personId: input.personId,
    subject: rendered.subject,
    body: rendered.body,
    templateId: input.templateId ?? null,
    extraTargets: extra,
    threadId,
    inReplyTo,
    scheduledFor: sendAt,
    track: input.track,
  });
  if (input.draftId) {
    // The draft went: it leaves compose, and a Review suggestion for it is done.
    await discardDraft(db, organizationId, input.draftId);
    await db.crmSuggestion.updateMany({
      where: { organizationId, kind: "DRAFT_EMAIL", status: "PENDING", payload: { path: ["draftId"], equals: input.draftId } },
      data: { status: "ACCEPTED", reviewedById: userId, reviewedAt: new Date() },
    });
  }
  return queued;
}

/** Cancels a message still waiting to go (sent later, or a sequence step). */
export async function cancelEmail(actor: CrmActor, messageId: string): Promise<void> {
  const { db, organizationId } = actor;
  const m = await db.crmEmailMessage.findFirst({
    where: { id: messageId, organizationId, status: "QUEUED" },
    select: { id: true, activityId: true },
  });
  if (!m) throw new CrmError("It already went, or it's gone.");
  await db.crmEmailMessage.update({ where: { id: m.id }, data: { status: "FAILED", error: "cancelled" } });
  if (m.activityId) {
    await db.crmActivity.updateMany({ where: { id: m.activityId, organizationId }, data: { deletedAt: new Date() } });
  }
}

// ---- Sending (the job) -----------------------------------------------------------------------

function purposeOf(m: { enrollmentId: string | null; campaignId: string | null; workflowId: string | null }, bulk: boolean): MailPurpose {
  if (bulk) return "bulk";
  if (m.enrollmentId || m.campaignId || m.workflowId) return "sequence";
  return "one-to-one";
}

function startOfUtcDay(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Sequence, campaign and automation mail a member's mailbox has sent today (and is about to). */
export async function sentToday(db: TxClient, organizationId: string, userId: string, now: Date = new Date()): Promise<number> {
  return db.crmEmailMessage.count({
    where: {
      organizationId,
      mailboxUserId: userId,
      direction: "OUTBOUND",
      status: "SENT",
      sentAt: { gte: startOfUtcDay(now) },
      OR: [{ enrollmentId: { not: null } }, { campaignId: { not: null } }, { workflowId: { not: null } }],
    },
  });
}

interface Prepared {
  messageId: string;
  organizationId: string;
  senderId: string | null;
  senderName: string | null;
  personId: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo: string | undefined;
  headers: Record<string, string>;
  purpose: MailPurpose;
  /** What the timeline keeps: the message as written and merged, without signature or footer. */
  written: string;
}

type PrepareOutcome = { send: Prepared } | { skip: string } | { later: Date };

async function prepare(db: TxClient, organizationId: string, messageId: string, now: Date): Promise<PrepareOutcome> {
  const m = await db.crmEmailMessage.findFirst({
    where: { id: messageId, organizationId },
    select: {
      id: true,
      status: true,
      subject: true,
      bodyText: true,
      toAddresses: true,
      mailboxUserId: true,
      trackingToken: true,
      inReplyTo: true,
      messageIdHeader: true,
      enrollmentId: true,
      campaignId: true,
      workflowId: true,
      scheduledFor: true,
      error: true,
      activityId: true,
    },
  });
  if (!m || m.status !== "QUEUED") return { skip: "not waiting" };
  if (m.scheduledFor && m.scheduledFor.getTime() > now.getTime() + 60_000) return { later: m.scheduledFor };
  const activity = m.activityId
    ? await db.crmActivityTarget.findFirst({
        where: { organizationId, activityId: m.activityId, targetKind: "person" },
        select: { targetId: true },
      })
    : null;
  // A bulk message has no timeline row until it goes: its person is its address.
  const byAddress =
    !activity && m.toAddresses[0]
      ? await db.crmPersonEmail.findFirst({
          where: { organizationId, email: m.toAddresses[0] },
          select: { personId: true },
        })
      : null;
  const personId = activity?.targetId ?? byAddress?.personId;
  const person = personId
    ? await db.crmPerson.findFirst({
        where: { id: personId, organizationId },
        select: { id: true, primaryEmail: true, doNotContact: true, unsubscribedAt: true, consent: true, deletedAt: true },
      })
    : null;
  const can = person ? contactable(person) : { ok: false, reason: "They're not in the CRM any more." };
  if (!person || !can.ok) return { skip: can.reason ?? "not contactable" };
  const campaign = m.campaignId
    ? await db.crmCampaign.findFirst({ where: { id: m.campaignId, organizationId }, select: { channel: true } })
    : null;
  const bulk = campaign?.channel === "bulk";
  if (bulk) {
    // Bulk mail is merged for each person as it goes.
    const values = await mergeValuesFor(db, organizationId, person.id, m.mailboxUserId, now);
    m.subject = renderMerge(m.subject ?? "", values).text;
    m.bodyText = renderMerge(m.bodyText ?? "", values).text;
  }
  const purpose = purposeOf(m, bulk);
  if (purpose === "sequence" && m.mailboxUserId) {
    const settings = await db.crmSettings.findUnique({ where: { organizationId }, select: { dailySendCap: true } });
    const cap = settings?.dailySendCap ?? 150;
    if ((await sentToday(db, organizationId, m.mailboxUserId, now)) >= cap) {
      const tomorrow = startOfUtcDay(new Date(now.getTime() + 86_400_000));
      return { later: new Date(tomorrow.getTime() + 13 * 3_600_000) };
    }
  }
  const sender = m.mailboxUserId
    ? await db.user.findUnique({ where: { id: m.mailboxUserId }, select: { name: true, email: true } })
    : null;
  const memberSettings = m.mailboxUserId
    ? await db.crmMemberSettings.findFirst({
        where: { organizationId, userId: m.mailboxUserId },
        select: { signature: true },
      })
    : null;
  const tracked = m.error !== "untracked";
  const token = m.trackingToken!;
  let text = m.bodyText ?? "";
  const signature = memberSettings?.signature?.trim();
  if (signature && !text.includes(signature)) text = `${text}\n\n${signature}`;
  const marketing = purpose !== "one-to-one";
  const headers: Record<string, string> = {};
  if (m.messageIdHeader) headers["Message-ID"] = `<${m.messageIdHeader}>`;
  if (m.inReplyTo) {
    headers["In-Reply-To"] = `<${m.inReplyTo}>`;
    headers["References"] = `<${m.inReplyTo}>`;
  }
  let footerHtml = "";
  if (marketing) {
    const unsub = unsubscribeUrl(organizationId, person.id);
    headers["List-Unsubscribe"] = `<${oneClickUrl(organizationId, person.id)}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    text = `${text}\n\n--\nDon't want these emails? Unsubscribe: ${unsub}`;
    footerHtml = `<p style="margin:24px 0 0;font-size:12px;color:#777">Don't want these emails? <a href="${unsub}">Unsubscribe</a>.</p>`;
  }
  const bodyForHtml = marketing ? text.slice(0, text.lastIndexOf("\n\n--\n")) : text;
  let html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f1f1f">${textToHtml(
    bodyForHtml,
    tracked ? (u) => clickUrl(token, u) : undefined,
  )}${footerHtml}</div>`;
  if (tracked) html += `<img src="${pixelUrl(token)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`;
  const replyTo = replyAddress(token) ?? sender?.email ?? undefined;
  return {
    send: {
      messageId: m.id,
      organizationId,
      senderId: m.mailboxUserId,
      senderName: sender?.name ?? null,
      personId: person.id,
      to: normalizeEmail(person.primaryEmail) ?? m.toAddresses[0]!,
      subject: m.subject ?? "",
      written: m.bodyText ?? "",
      text,
      html,
      replyTo,
      headers,
      purpose,
    },
  };
}

/** Records a sent message: status, its timeline row, the campaign target. */
async function markSent(
  db: TxClient,
  p: Prepared,
  sent: SentEmail,
  now: Date,
): Promise<void> {
  const updated = await db.crmEmailMessage.updateMany({
    where: { id: p.messageId, organizationId: p.organizationId, status: "QUEUED" },
    data: {
      status: "SENT",
      sentAt: now,
      fromAddress: sent.from.slice(0, 300),
      toAddresses: [p.to],
      providerMessageId: sent.providerId,
      mailbox: sent.mailbox,
      error: null,
      subject: p.subject.slice(0, 300),
      bodyText: p.written.slice(0, 50_000),
    },
  });
  if (updated.count === 0) return;
  const m = await db.crmEmailMessage.findFirst({
    where: { id: p.messageId, organizationId: p.organizationId },
    select: { subject: true, bodyText: true, enrollmentId: true, campaignId: true, templateId: true, threadId: true, workflowId: true },
  });
  const person = await db.crmPerson.findFirst({
    where: { id: p.personId, organizationId: p.organizationId },
    select: { companyId: true },
  });
  const activityId = await logActivity(db, {
    organizationId: p.organizationId,
    kind: "EMAIL",
    direction: "OUTBOUND",
    subject: m?.subject ?? p.subject,
    body: m?.bodyText ?? null,
    occurredAt: now,
    targets: [
      { kind: "person", id: p.personId },
      ...(person?.companyId ? [{ kind: "company" as const, id: person.companyId }] : []),
    ],
    actorId: p.senderId,
    sourceKind: SOURCE_KIND,
    sourceId: p.messageId,
    privateToId: null,
    meta: {
      status: "sent",
      messageId: p.messageId,
      threadId: m?.threadId ?? null,
      ...(m?.enrollmentId ? { enrollmentId: m.enrollmentId } : {}),
      ...(m?.campaignId ? { campaignId: m.campaignId } : {}),
      ...(m?.templateId ? { templateId: m.templateId } : {}),
      ...(m?.workflowId ? { workflowId: m.workflowId } : {}),
    },
  });
  await db.crmEmailMessage.update({ where: { id: p.messageId }, data: { activityId } });
  if (m?.campaignId) {
    await db.crmCampaignTarget.updateMany({
      where: { organizationId: p.organizationId, campaignId: m.campaignId, personId: p.personId, status: "TODO" },
      data: { status: "CONTACTED", contactedAt: now },
    });
  }
}

async function markFailed(db: TxClient, organizationId: string, messageId: string, reason: string): Promise<void> {
  const m = await db.crmEmailMessage.findFirst({
    where: { id: messageId, organizationId, status: "QUEUED" },
    select: { activityId: true, subject: true },
  });
  if (!m) return;
  await db.crmEmailMessage.update({ where: { id: messageId }, data: { status: "FAILED", error: reason.slice(0, 300) } });
  if (m.activityId) {
    await db.crmActivity.updateMany({
      where: { id: m.activityId, organizationId },
      data: { subject: `Not sent: ${m.subject ?? "email"} (${reason.slice(0, 120)})`, meta: { status: "failed" } },
    });
  }
}

/** Sends one queued message; returns what happened. Used by crm-send and crm-bulk. */
export async function deliver(
  organizationId: string,
  messageId: string,
  signal?: AbortSignal,
  now: Date = new Date(),
): Promise<"sent" | "skipped" | "later" | "failed"> {
  const outcome = await withSystemOrgTx(organizationId, ({ db }) => prepare(db, organizationId, messageId, now));
  if ("skip" in outcome) {
    await withSystemOrgTx(organizationId, ({ db }) => markFailed(db, organizationId, messageId, outcome.skip));
    return "skipped";
  }
  if ("later" in outcome) {
    await withSystemOrgTx(organizationId, async ({ db }) => {
      await db.crmEmailMessage.updateMany({
        where: { id: messageId, organizationId, status: "QUEUED" },
        data: { scheduledFor: outcome.later },
      });
      await enqueueJob(db, {
        orgId: organizationId,
        kind: "crm-send",
        key: `${messageId}:${outcome.later.getTime().toString(36)}`,
        payload: { messageId },
        runAt: outcome.later,
        noKick: true,
      });
    });
    return "later";
  }
  const p = outcome.send;
  // Bulk mail is volume on the organization's own Resend account: past the
  // monthly spending cap it stops (one-to-one mail still goes).
  if (p.purpose === "bulk" && !(await underCap(organizationId, costOf("email.sent")))) {
    await withSystemOrgTx(organizationId, ({ db }) => markFailed(db, organizationId, messageId, "This month's spending cap is reached"));
    return "failed";
  }
  try {
    const sent = await sendFromMailbox({
      organizationId,
      senderUserId: p.senderId,
      senderName: p.senderName,
      purpose: p.purpose,
      message: { to: p.to, subject: p.subject, text: p.text, html: p.html, replyTo: p.replyTo, headers: p.headers },
      idempotencyKey: p.messageId,
      signal,
    });
    await withSystemOrgTx(organizationId, async ({ db }) => {
      await markSent(db, p, sent, new Date());
      if (sent.paidBy === "ORG_KEY") {
        await meterUseIn(db, { organizationId, userId: p.senderId, feature: "crm.email", provider: "resend", what: "email.sent" });
      }
    });
    return "sent";
  } catch (error) {
    if (error instanceof EmailConfigError) {
      await withSystemOrgTx(organizationId, ({ db }) => markFailed(db, organizationId, messageId, error.message));
      return "failed";
    }
    throw error;
  }
}

export const crmSendJob: JobHandler<{ messageId: string }> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-send needs an organization");
  try {
    await deliver(orgId, run.payload.messageId, run.signal);
  } catch (error) {
    if (run.attempt >= run.maxAttempts) {
      await withSystemOrgTx(orgId, ({ db }) =>
        markFailed(db, orgId, run.payload.messageId, error instanceof Error ? error.message : "send failed"),
      );
      return;
    }
    throw error;
  }
};

/** A bulk campaign's mail, 25 a turn, continuing itself until none is left. */
export const crmBulkJob: JobHandler<{ campaignId: string }> = async (run) => {
  const orgId = run.organizationId;
  if (!orgId) throw new PermanentJobError("crm-bulk needs an organization");
  const { campaignId } = run.payload;
  while (Date.now() < run.deadline - 15_000) {
    const batch = await withSystemOrgTx(orgId, ({ db }) =>
      db.crmEmailMessage.findMany({
        where: { organizationId: orgId, campaignId, status: "QUEUED" },
        orderBy: { createdAt: "asc" },
        take: 25,
        select: { id: true },
      }),
    );
    if (batch.length === 0) {
      await withSystemOrgTx(orgId, ({ db }) =>
        db.crmCampaign.updateMany({ where: { id: campaignId, organizationId: orgId, channel: "bulk" }, data: { status: "DONE" } }),
      );
      return;
    }
    for (const m of batch) {
      if (Date.now() > run.deadline - 10_000) break;
      try {
        await deliver(orgId, m.id, run.signal);
      } catch (error) {
        await withSystemOrgTx(orgId, ({ db }) =>
          markFailed(db, orgId, m.id, error instanceof Error ? error.message : "send failed"),
        );
      }
    }
  }
  await withSystemOrgTx(orgId, ({ db }) =>
    enqueueJob(db, {
      orgId,
      kind: "crm-bulk",
      key: `${campaignId}:${Date.now().toString(36)}`,
      payload: { campaignId },
      noKick: true,
    }),
  );
};
