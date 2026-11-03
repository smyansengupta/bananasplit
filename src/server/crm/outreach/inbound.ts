import type { CrmMailbox, Prisma } from "@/generated/prisma/client";
import { normalizeEmail, workDomain } from "@/lib/crm/dedupe";
import {
  addressList,
  autoReplyOf,
  bareAddress,
  bounceOf,
  displayNameOf,
  domainOfAddress,
  isRobot,
  neverLogged,
  newText,
  signatureOf,
  type InboundMessage,
} from "@/lib/crm/outreach/inbound";
import { withSystemOrgTx, type TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { notifyUser } from "@/server/notifications";

import { logActivity, type ActivityTarget } from "../activity";
import { emitCrmEvent } from "../events";
import { inboundDomain } from "./mailbox";
import { SOURCE_KIND } from "./send";

/**
 * The ONE way mail comes into the CRM (docs/features/crm.md, "Email
 * connections"): ingestEmail(source, message). The BCC address, replies to
 * our Reply-To, and later Gmail, Outlook and IMAP sync each turn their mail
 * into an InboundMessage and call it. It:
 *
 * - drops what isn't ours to log: a member's never-log addresses, mail with
 *   nobody the CRM knows and no company domain it works with, robots;
 * - respects the mailbox's share mode: NONE logs nothing (a reply still
 *   stops its sequence), METADATA logs who and when, FULL the message;
 * - threads by Message-ID / In-Reply-To / References, and never logs the
 *   same message twice;
 * - matches people by address and companies by domain;
 * - suggests new people from signatures as CrmSuggestion rows, never
 *   creating them silently;
 * - reads bounces (stop, flag the address) and out-of-office replies
 *   (pause the sequence until they're back), and real replies (stop the
 *   sequence, mark the campaign, tell the member, emit email.replied).
 *
 * Runs on the service path in the message's one organization.
 */

export type InboundSource =
  | { kind: "bcc"; organizationId: string; userId: string }
  | { kind: "reply"; organizationId: string; messageId: string }
  | { kind: "gmail" | "outlook" | "imap"; organizationId: string; userId: string };

export interface IngestResult {
  status: "logged" | "suggested" | "ignored" | "duplicate" | "bounce" | "out-of-office";
  messageId?: string;
  people?: string[];
  reason?: string;
}

const MAILBOX: Record<InboundSource["kind"], CrmMailbox> = {
  bcc: "BCC",
  reply: "REPLY",
  gmail: "GMAIL",
  outlook: "OUTLOOK",
  imap: "IMAP",
};

async function ourMessageFor(db: TxClient, organizationId: string, m: InboundMessage) {
  const ids = [m.inReplyTo, ...m.references].filter((x): x is string => Boolean(x));
  if (ids.length === 0) return null;
  return db.crmEmailMessage.findFirst({
    where: { organizationId, messageIdHeader: { in: ids } },
    orderBy: { createdAt: "desc" },
    select: { id: true, threadId: true, mailboxUserId: true, enrollmentId: true, campaignId: true, activityId: true, subject: true },
  });
}

async function personOfMessage(db: TxClient, organizationId: string, activityId: string | null): Promise<string | null> {
  if (!activityId) return null;
  const t = await db.crmActivityTarget.findFirst({
    where: { organizationId, activityId, targetKind: "person" },
    select: { targetId: true },
  });
  return t?.targetId ?? null;
}

/** Stops (or pauses) a person's sequences. */
export async function stopEnrollments(
  db: TxClient,
  organizationId: string,
  personId: string,
  status: "REPLIED" | "BOUNCED" | "UNSUBSCRIBED" | "BOOKED" | "PAUSED",
  reason: string,
  resumeAt?: Date | null,
): Promise<number> {
  const where: Prisma.CrmEnrollmentWhereInput = {
    organizationId,
    personId,
    status: status === "PAUSED" ? "ACTIVE" : { in: ["ACTIVE", "PAUSED"] },
    ...(status === "REPLIED" ? { sequence: { stopOnReply: true } } : {}),
    ...(status === "BOOKED" ? { sequence: { stopOnBooking: true } } : {}),
  };
  const rows = await db.crmEnrollment.findMany({ where, select: { id: true, nextStep: true, sequenceId: true } });
  for (const r of rows) {
    await db.crmEnrollment.update({
      where: { id: r.id },
      data:
        status === "PAUSED"
          ? { status, stopReason: reason, nextRunAt: resumeAt ?? null }
          : { status, stopReason: reason, finishedAt: new Date(), nextRunAt: null },
    });
    if (status === "PAUSED" && resumeAt) {
      await enqueueJob(db, {
        orgId: organizationId,
        kind: "crm-sequence",
        key: `${r.id}:${r.nextStep}:resume`,
        payload: { enrollmentId: r.id, step: r.nextStep },
        runAt: resumeAt,
        noKick: true,
      });
    }
  }
  // Their queued sequence mail goes nowhere now.
  if (status !== "PAUSED" && rows.length) {
    await db.crmEmailMessage.updateMany({
      where: { organizationId, status: "QUEUED", enrollmentId: { in: rows.map((r) => r.id) } },
      data: { status: "FAILED", error: `stopped: ${reason}` },
    });
  }
  return rows.length;
}



/** Marks a person's campaign targets (forward only). */
export async function advanceTargets(
  db: TxClient,
  organizationId: string,
  personId: string,
  status: "REPLIED" | "BOOKED" | "CONVERTED",
  campaignId?: string | null,
): Promise<void> {
  const before: Record<typeof status, ("TODO" | "CONTACTED" | "REPLIED" | "BOOKED")[]> = {
    REPLIED: ["TODO", "CONTACTED"],
    BOOKED: ["TODO", "CONTACTED", "REPLIED"],
    CONVERTED: ["TODO", "CONTACTED", "REPLIED", "BOOKED"],
  };
  await db.crmCampaignTarget.updateMany({
    where: {
      organizationId,
      personId,
      status: { in: before[status] },
      ...(campaignId ? { campaignId } : { campaign: { status: "ACTIVE" } }),
    },
    data: { status, ...(status === "REPLIED" ? { repliedAt: new Date() } : {}) },
  });
}

async function handleBounce(
  db: TxClient,
  organizationId: string,
  m: InboundMessage,
  ours: Awaited<ReturnType<typeof ourMessageFor>>,
): Promise<IngestResult> {
  const b = bounceOf(m);
  let original = ours;
  if (!original && b.recipient) {
    original = await db.crmEmailMessage.findFirst({
      where: { organizationId, direction: "OUTBOUND", toAddresses: { has: b.recipient }, status: "SENT" },
      orderBy: { sentAt: "desc" },
      select: { id: true, threadId: true, mailboxUserId: true, enrollmentId: true, campaignId: true, activityId: true, subject: true },
    });
  }
  if (!original) return { status: "ignored", reason: "a bounce for mail we didn't send" };
  if (!b.permanent) return { status: "ignored", reason: "a temporary failure" };
  await db.crmEmailMessage.update({ where: { id: original.id }, data: { status: "BOUNCED", bouncedAt: new Date() } });
  const personId = await personOfMessage(db, organizationId, original.activityId);
  if (personId) {
    const person = await db.crmPerson.findFirst({ where: { id: personId, organizationId }, select: { consent: true } });
    const consent = { ...((person?.consent ?? {}) as Record<string, unknown>) };
    consent.email = { ...((consent.email ?? {}) as Record<string, unknown>), bounced: true, at: new Date().toISOString() };
    await db.crmPerson.update({ where: { id: personId }, data: { consent: consent as Prisma.InputJsonObject } });
    await stopEnrollments(db, organizationId, personId, "BOUNCED", "their address bounced");
    await logActivity(db, {
      organizationId,
      kind: "SYSTEM",
      subject: `Email bounced: ${original.subject ?? ""}`.trim(),
      targets: [{ kind: "person", id: personId }],
      sourceKind: "crm-bounce",
      sourceId: original.id,
    });
    await emitCrmEvent(db, organizationId, {
      type: "email.bounced",
      targetKind: "person",
      targetId: personId,
      sourceId: original.id,
      source: "system",
    });
  }
  return { status: "bounce", messageId: original.id, people: personId ? [personId] : [] };
}

/** Takes one message in. Idempotent: the same Message-ID twice logs once. */
export async function ingestEmail(source: InboundSource, m: InboundMessage, now: Date = new Date()): Promise<IngestResult> {
  const organizationId = source.organizationId;
  return withSystemOrgTx(organizationId, async ({ db }) => {
    if (m.messageId) {
      const dup = await db.crmEmailMessage.findFirst({
        where: { organizationId, messageIdHeader: m.messageId },
        select: { id: true },
      });
      if (dup) return { status: "duplicate", messageId: dup.id };
    }
    const crm = await db.crmSettings.findUnique({ where: { organizationId }, select: { organizationId: true } });
    if (!crm) return { status: "ignored", reason: "the CRM isn't set up" };

    let ours = await ourMessageFor(db, organizationId, m);
    if (source.kind === "reply" && !ours) {
      ours = await db.crmEmailMessage.findFirst({
        where: { id: source.messageId, organizationId },
        select: { id: true, threadId: true, mailboxUserId: true, enrollmentId: true, campaignId: true, activityId: true, subject: true },
      });
    }
    if (bounceOf(m).bounced) return handleBounce(db, organizationId, m, ours);

    const mailboxUserId = source.kind === "reply" ? (ours?.mailboxUserId ?? null) : source.userId;
    const settings = mailboxUserId
      ? await db.crmMemberSettings.findFirst({
          where: { organizationId, userId: mailboxUserId },
          select: { shareMode: true, neverLog: true },
        })
      : null;
    const shareMode = settings?.shareMode ?? "FULL";
    const neverLog = settings?.neverLog ?? [];

    // Who's on it, minus us and the organization's own members.
    const domain = inboundDomain();
    const from = bareAddress(m.from);
    const all = addressList([m.from, ...m.to, ...m.cc, ...(m.envelopeTo ?? [])]);
    const members = await db.membership.findMany({
      where: { organizationId },
      select: { userId: true, user: { select: { email: true } } },
      take: 5000,
    });
    const memberEmails = new Map(members.map((x) => [x.user.email.toLowerCase(), x.userId]));
    const isOurs = (a: string) => (domain ? domainOfAddress(a) === domain : false) || memberEmails.has(a);
    const direction = from && memberEmails.has(from) ? "OUTBOUND" : "INBOUND";
    const counterpart = (direction === "OUTBOUND" ? all.filter((a) => a !== from) : from ? [from, ...addressList(m.cc)] : [])
      .filter((a) => !isOurs(a))
      .filter((a) => !neverLogged(a, neverLog));

    // Match people by address, companies by work domain.
    const peopleIds: string[] = [];
    const companyIds: string[] = [];
    const unknown: string[] = [];
    for (const a of counterpart.slice(0, 50)) {
      const e = normalizeEmail(a);
      if (!e) continue;
      const row = await db.crmPersonEmail.findFirst({
        where: { organizationId, email: e, person: { deletedAt: null } },
        select: { personId: true, person: { select: { companyId: true } } },
      });
      if (row) {
        if (!peopleIds.includes(row.personId)) peopleIds.push(row.personId);
        if (row.person.companyId && !companyIds.includes(row.person.companyId)) companyIds.push(row.person.companyId);
        continue;
      }
      unknown.push(e);
      const d = workDomain(e);
      if (d) {
        const c = await db.crmCompany.findFirst({ where: { organizationId, domain: d, deletedAt: null }, select: { id: true } });
        if (c && !companyIds.includes(c.id)) companyIds.push(c.id);
      }
    }
    const replyPerson = ours ? await personOfMessage(db, organizationId, ours.activityId) : null;
    if (replyPerson && !peopleIds.includes(replyPerson)) peopleIds.push(replyPerson);

    // Suggest the people we don't know (from what they signed), never silently making them.
    const suggest = unknown.filter((a) => !isRobot(a) && (source.kind === "bcc" || companyIds.length > 0 || direction === "INBOUND"));
    for (const a of suggest.slice(0, 5)) {
      const fromThem = a === from;
      const sig = fromThem ? signatureOf(m.text, displayNameOf(m.from)) : { name: null, title: null, company: null, phone: null };
      const pending = await db.crmSuggestion.findFirst({
        where: { organizationId, kind: "CREATE_PERSON", status: "PENDING", targetKind: "email", targetId: a },
        select: { id: true },
      });
      if (pending) continue;
      await db.crmSuggestion.create({
        data: {
          organizationId,
          kind: "CREATE_PERSON",
          source: "EMAIL",
          title: `Add ${sig.name ?? a}`,
          summary: [sig.title, sig.company, sig.phone].filter(Boolean).join(", ") || `From an email: ${m.subject.slice(0, 120)}`,
          payload: {
            email: a,
            name: sig.name,
            title: sig.title,
            company: sig.company,
            phone: sig.phone,
            companyId: companyIds[0] ?? null,
          },
          targetKind: "email",
          targetId: a,
          citation: { kind: "email", label: m.subject.slice(0, 200) },
          assigneeId: mailboxUserId,
          expiresAt: new Date(now.getTime() + 30 * 86_400_000),
        },
      });
    }
    if (peopleIds.length === 0 && companyIds.length === 0) {
      return { status: suggest.length ? "suggested" : "ignored", reason: "nobody the CRM knows" };
    }

    const auto = direction === "INBOUND" ? autoReplyOf(m, now) : { outOfOffice: false, automatic: false, backOn: null };
    const isReply = direction === "INBOUND" && !auto.automatic;
    const text = newText(m.text);

    // Out of office: pause their sequences until they're back (a day after, or a week without a date).
    if (auto.outOfOffice) {
      const resume = auto.backOn ? new Date(auto.backOn.getTime() + 86_400_000) : new Date(now.getTime() + 7 * 86_400_000);
      for (const p of peopleIds) await stopEnrollments(db, organizationId, p, "PAUSED", "out of office", resume);
      return { status: "out-of-office", people: peopleIds };
    }
    if (auto.automatic) return { status: "ignored", reason: "an automatic message" };

    // NONE: nothing is kept, but a reply still stops what it answers.
    let messageId: string | undefined;
    if (shareMode !== "NONE") {
      const threadId =
        ours?.threadId ??
        (
          await db.crmEmailThread.create({
            data: { organizationId, subject: shareMode === "FULL" ? m.subject.slice(0, 300) : null },
            select: { id: true },
          })
        ).id;
      const created = await db.crmEmailMessage.create({
        data: {
          organizationId,
          threadId,
          direction,
          status: direction === "INBOUND" ? "RECEIVED" : "SENT",
          mailbox: MAILBOX[source.kind],
          mailboxUserId,
          messageIdHeader: m.messageId,
          inReplyTo: m.inReplyTo,
          fromAddress: (from ?? "unknown").slice(0, 300),
          toAddresses: addressList(m.to).slice(0, 50),
          ccAddresses: addressList(m.cc).slice(0, 50),
          subject: shareMode === "FULL" ? m.subject.slice(0, 300) : null,
          bodyText: shareMode === "FULL" ? text.slice(0, 50_000) : null,
          sentAt: m.date ?? now,
        },
        select: { id: true },
      });
      messageId = created.id;
      await db.crmEmailThread.update({ where: { id: threadId }, data: { lastMessageAt: m.date ?? now } });
      const targets: ActivityTarget[] = [
        ...peopleIds.map((id) => ({ kind: "person" as const, id })),
        ...companyIds.map((id) => ({ kind: "company" as const, id })),
      ];
      const activityId = await logActivity(db, {
        organizationId,
        kind: "EMAIL",
        direction,
        subject: shareMode === "FULL" ? m.subject.slice(0, 300) || "(no subject)" : null,
        body: shareMode === "FULL" ? text.slice(0, 20_000) : null,
        occurredAt: m.date && m.date.getTime() <= now.getTime() + 60_000 ? m.date : now,
        targets,
        actorId: mailboxUserId,
        sourceKind: SOURCE_KIND,
        sourceId: created.id,
        meta: { messageId: created.id, threadId, via: source.kind, shared: shareMode, ...(ours ? { inReplyTo: ours.id } : {}) },
      });
      await db.crmEmailMessage.update({ where: { id: created.id }, data: { activityId } });
    }

    if (isReply) {
      if (ours) await db.crmEmailMessage.updateMany({ where: { id: ours.id, organizationId, repliedAt: null }, data: { repliedAt: now } });
      for (const p of peopleIds) {
        await stopEnrollments(db, organizationId, p, "REPLIED", "they replied");
        await advanceTargets(db, organizationId, p, "REPLIED", ours?.campaignId ?? null);
        await emitCrmEvent(db, organizationId, {
          type: "email.replied",
          targetKind: "person",
          targetId: p,
          sourceId: messageId ?? ours?.id,
          source: "system",
        });
      }
      // The reply came to our Reply-To: the member hears about it (and gets the words).
      if (source.kind === "reply" && mailboxUserId && peopleIds[0]) {
        const person = await db.crmPerson.findFirst({ where: { id: peopleIds[0], organizationId }, select: { name: true } });
        const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
        await notifyUser(db, organizationId, mailboxUserId, {
          type: "CRM_REPLY",
          title: `${person?.name ?? "Someone"} replied: ${m.subject}`.slice(0, 300),
          body: text.slice(0, 1800) || null,
          linkUrl: org ? `/app/${org.slug}/crm/people/${peopleIds[0]}` : null,
          dedupeKey: `crm-reply:${m.messageId ?? messageId ?? now.getTime()}`,
        });
      }
    }
    return { status: messageId ? "logged" : "ignored", messageId, people: peopleIds, reason: messageId ? undefined : "this mailbox shares nothing" };
  });
}
