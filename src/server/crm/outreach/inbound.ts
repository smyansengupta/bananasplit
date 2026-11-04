import type { CrmMailbox, Prisma } from "@/generated/prisma/client";
import { normalizeEmail, workDomain } from "@/lib/crm/dedupe";
import { crmRecordHref } from "@/lib/crm/href";
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
import { crmBase } from "@/lib/crm/href";

import { logActivity, type ActivityTarget } from "../activity";
import { emitCrmEvent } from "../events";
import { crmInbox } from "../inbox-notify";
import { queueIssueRefresh } from "../issue-queue";
import { proposeChange } from "../review";
import { inboundDomain } from "./mailbox";
import { SOURCE_KIND, WITHDRAWN } from "./send";

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
  // Their queued sequence mail goes nowhere now, and a step's draft waiting
  // for someone's OK is withdrawn (with its To approve row).
  if (status !== "PAUSED" && rows.length) {
    const ids = rows.map((r) => r.id);
    await db.crmEmailMessage.updateMany({
      where: { organizationId, status: { in: ["QUEUED", "SCHEDULED"] }, enrollmentId: { in: ids } },
      data: { status: "FAILED", error: `stopped: ${reason}` },
    });
    const drafts = await db.crmEmailMessage.findMany({
      where: { organizationId, status: "DRAFT", enrollmentId: { in: ids } },
      select: { id: true },
    });
    if (drafts.length) {
      // Marked withdrawn, so Send on it later says why instead of sending.
      await db.crmEmailMessage.updateMany({
        where: { organizationId, id: { in: drafts.map((d) => d.id) } },
        data: { status: "FAILED", error: `${WITHDRAWN} ${reason}` },
      });
      for (const d of drafts) {
        await db.crmSuggestion.updateMany({
          where: { organizationId, kind: "DRAFT_EMAIL", status: "PENDING", payload: { path: ["draftId"], equals: d.id } },
          data: { status: "EXPIRED" },
        });
      }
    }
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
  // Found by address only when the bounce itself checks out: anyone can
  // write a bounce naming an address, and it flags that address for good.
  if (!original && b.recipient && m.senderVerified === true) {
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
    // Anyone can write any From line: only a sender whose mail checked out
    // (SPF, DKIM or DMARC, the Worker's verdict) is taken as who it says.
    const verified = m.senderVerified === true;
    const all = addressList([m.from, ...m.to, ...m.cc, ...(m.envelopeTo ?? [])]);
    const members = await db.membership.findMany({
      where: { organizationId },
      select: { userId: true, user: { select: { email: true } } },
      take: 5000,
    });
    const memberEmails = new Map(members.map((x) => [x.user.email.toLowerCase(), x.userId]));
    const isOurs = (a: string) => (domain ? domainOfAddress(a) === domain : false) || memberEmails.has(a);
    const fromMember = Boolean(from && memberEmails.has(from));
    // Never logged as a member's own email unless it really is from them.
    if (fromMember && !verified) return { status: "ignored", reason: "the sender couldn't be verified" };
    const direction = fromMember ? "OUTBOUND" : "INBOUND";
    // A member's own mail (BCC'd) is about everyone on it. Mail coming in is
    // about its sender alone, and only when the sender checks out: a Cc'd
    // contact's timeline, sequences and issue are never touched by someone
    // else's mail, and nothing is done for an address that may be forged.
    const counterpart = (direction === "OUTBOUND" ? all.filter((a) => a !== from) : from && verified ? [from] : [])
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
    // The person our email went to counts only when it's really them writing
    // back (their checked address is one of theirs, so they matched above).
    // Someone a checked sender Cc'd who isn't in the CRM yet may still be
    // suggested (Review decides); nothing is written about them.
    if (direction === "INBOUND" && verified) {
      for (const a of addressList(m.cc).slice(0, 20)) {
        const e = normalizeEmail(a);
        if (!e || isOurs(e) || neverLogged(e, neverLog) || unknown.includes(e)) continue;
        const known = await db.crmPersonEmail.findFirst({ where: { organizationId, email: e }, select: { id: true } });
        if (!known) unknown.push(e);
      }
    }

    // Suggest the people we don't know (from what they signed), never silently making them.
    const suggest = unknown.filter((a) => !isRobot(a) && (source.kind === "bcc" || companyIds.length > 0 || direction === "INBOUND"));
    for (const a of suggest.slice(0, 5)) {
      const fromThem = a === from;
      const sig = fromThem ? signatureOf(m.text, displayNameOf(m.from)) : { name: null, title: null, company: null, phone: null };
      // One review queue: a new person waits in Review (and Outreach, Your mail) like any other suggestion.
      const pending = await db.crmSuggestion.findFirst({
        where: { organizationId, kind: "CREATE_PERSON", status: "PENDING", payload: { path: ["person", "primaryEmail"], equals: a } },
        select: { id: true },
      });
      if (pending) continue;
      const known = !sig.company && companyIds[0]
        ? await db.crmCompany.findFirst({ where: { id: companyIds[0], organizationId }, select: { name: true } })
        : null;
      await proposeChange(db, {
        organizationId,
        kind: "CREATE_PERSON",
        source: "EMAIL",
        title: `Add ${sig.name ?? a}`,
        summary: [sig.title, sig.company, sig.phone].filter(Boolean).join(", ") || `From an email: ${m.subject.slice(0, 120)}`,
        payload: {
          person: {
            name: sig.name ?? a,
            primaryEmail: a,
            title: sig.title,
            phone: sig.phone,
            companyName: sig.company ?? known?.name ?? null,
          },
        },
        citation: { kind: "email", label: m.subject.slice(0, 200) || "an email" },
        assigneeId: mailboxUserId,
        expiresAt: new Date(now.getTime() + 30 * 86_400_000),
      });
    }
    if (peopleIds.length === 0 && companyIds.length === 0) {
      if (direction === "INBOUND" && !verified) return { status: "ignored", reason: "the sender couldn't be verified" };
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
          // Who it is from or to, when it is one person the CRM knows.
          personId: peopleIds.length === 1 ? peopleIds[0] : null,
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
      // What they wrote may change their biggest issue (at most once an hour each).
      if (direction === "INBOUND") {
        await queueIssueRefresh(db, organizationId, peopleIds, mailboxUserId ?? null, { hourly: true });
      }
    }

    if (isReply && peopleIds.length) {
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
      // The reply came to our Reply-To: the member hears about it, a burst of
      // replies folding into one Inbox row (crmInbox's grouping).
      if (source.kind === "reply" && mailboxUserId && peopleIds[0]) {
        const person = await db.crmPerson.findFirst({ where: { id: peopleIds[0], organizationId }, select: { name: true } });
        const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
        const who = person?.name ?? "Someone";
        await crmInbox(db, organizationId, [mailboxUserId], {
          type: "CRM_REPLY",
          group: "reply",
          title: `${who} replied: ${m.subject}`.slice(0, 300),
          body: text.slice(0, 1800) || null,
          linkUrl: org ? crmRecordHref(org.slug, "person", peopleIds[0]) : null,
          many: (n) => ({ title: `${n} new replies`, linkUrl: org ? crmBase(org.slug) : null }),
          latest: `Latest: ${who}, ${m.subject}`.slice(0, 300),
          key: `reply-${m.messageId ?? messageId ?? now.getTime()}`,
        });
      }
    }
    return { status: messageId ? "logged" : "ignored", messageId, people: peopleIds, reason: messageId ? undefined : "this mailbox shares nothing" };
  });
}
