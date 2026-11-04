import type { Prisma } from "@/generated/prisma/client";
import {
  canText,
  formatNumber,
  inQuietHours,
  localMinutes,
  maskNumber,
  phoneKey,
  readConsent,
  textKeyword,
  toE164,
  withConsent,
  type ChannelConsent,
  type ConsentChannel,
  type Keyword,
} from "@/lib/crm/phone";
import { missingKeyMessage } from "@/lib/crm/org-keys";
import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";

import { CrmError, type CrmActor } from "../access";
import { logActivity } from "../activity";
import { queueIssueRefresh } from "../issue-queue";
import { writeHistory } from "../history";
import { createPerson } from "../people";
import { phoneStatus } from "./connection";

/**
 * Two-way texting (docs/features/crm.md module 5, "Texting", and
 * "Deliverability and law"): on the organization's own Telnyx or Twilio
 * number, sent by a job through the SMS module (no network in the action),
 * every text on the person's timeline (kind TEXT).
 *
 * - No first text without consent: a person's text consent records how it
 *   was given (CrmPerson.consent.text), and do-not-contact always wins.
 * - Quiet hours: a text written during them waits until they end (the
 *   job's runAt), in the organization's time zone.
 * - STOP, START and HELP from a person set their consent (and STOP sets
 *   do-not-contact); the providers send the carriers' required replies
 *   themselves, so nothing more is sent to someone who said STOP.
 * - Numbers never reach a log in full (maskNumber).
 */

export const MAX_TEXT = 1_000;

/** Records consent for one channel, with how it was given; field history keeps who and when. */
export async function setConsent(
  actor: CrmActor,
  personId: string,
  channel: ConsentChannel,
  input: { granted: boolean; how: string },
): Promise<void> {
  const { db, organizationId, userId } = actor;
  const how = input.how.trim().slice(0, 120);
  if (!how) throw new CrmError("Say how they said yes.");
  const person = await db.crmPerson.findFirst({
    where: { id: personId, organizationId, deletedAt: null },
    select: { id: true, consent: true },
  });
  if (!person) throw new CrmError("That person isn't in the CRM any more.");
  const before = readConsent(person.consent)[channel] ?? null;
  const value: ChannelConsent = { granted: input.granted, how, at: new Date().toISOString(), by: userId };
  await db.crmPerson.update({
    where: { id: person.id },
    data: { consent: withConsent(person.consent, channel, value) as Prisma.InputJsonObject, updatedById: userId },
  });
  await writeHistory(db, {
    organizationId,
    targetKind: "person",
    targetId: person.id,
    changes: [{ field: `consent.${channel}`, oldValue: before, newValue: value }],
    userId,
  });
}

/** When a text written now may go: now, or the end of tonight's quiet hours. */
export function sendAt(now: Date, timeZone: string, quiet: { quietStart: string; quietEnd: string }): Date {
  if (!inQuietHours(quiet, now, timeZone)) return now;
  const [h, m] = quiet.quietEnd.split(":").map(Number);
  const end = (h ?? 0) * 60 + (m ?? 0);
  const local = localMinutes(now, timeZone);
  const wait = (end - local + 1440) % 1440 || 1440;
  return new Date(now.getTime() + wait * 60_000);
}

/**
 * Writes a text and queues it; returns its id and when it goes. The member
 * acting pressed Send, unless `approvedById` says who did (a plan's first
 * text: whoever pressed Start). The send job checks it again.
 */
export async function queueText(
  actor: CrmActor,
  input: { personId: string; body: string; approvedById?: string | null },
): Promise<{ textId: string; sendAt: Date; waiting: boolean }> {
  const { db, organizationId, userId } = actor;
  const body = input.body.trim();
  if (!body) throw new CrmError("Write the text first.");
  if (body.length > MAX_TEXT) throw new CrmError(`Keep a text under ${MAX_TEXT} characters.`);
  // Which provider and number: the service path (members can't read integrations).
  const status = await phoneStatus(organizationId);
  if (!status.active) throw new CrmError(missingKeyMessage("Telnyx or Twilio"));
  if (!status.number) throw new CrmError("Pick the number texts go out from on Integrations and apps.");
  const person = await db.crmPerson.findFirst({
    where: { id: input.personId, organizationId, deletedAt: null },
    select: { id: true, phone: true, doNotContact: true, consent: true, companyId: true },
  });
  if (!person) throw new CrmError("That person isn't in the CRM any more.");
  const allowed = canText(person);
  if (!allowed.ok) {
    throw new CrmError(
      allowed.reason === "no-phone"
        ? "Add their number first."
        : allowed.reason === "do-not-contact"
          ? "They asked not to be contacted."
          : allowed.reason === "opted-out"
            ? "They texted STOP. They have to text START before you can text them."
            : "Record how they agreed to texts first.",
    );
  }
  const to = toE164(person.phone);
  if (!to) throw new CrmError("Their number needs its country code, like +1.");
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
  const now = new Date();
  const at = sendAt(now, org?.timezone ?? "UTC", status.settings);
  const text = await db.crmTextMessage.create({
    data: {
      organizationId,
      personId: person.id,
      userId,
      direction: "OUTBOUND",
      fromNumber: status.number,
      toNumber: to,
      body,
      provider: status.active,
      status: at > now ? "scheduled" : "queued",
      sentAt: at,
      approvedById: input.approvedById === undefined ? userId : input.approvedById,
    },
    select: { id: true },
  });
  const activityId = await logActivity(db, {
    organizationId,
    kind: "TEXT",
    direction: "OUTBOUND",
    subject: "Text",
    body,
    occurredAt: now,
    actorId: userId,
    createdById: userId,
    sourceKind: "text",
    sourceId: text.id,
    targets: [{ kind: "person", id: person.id }, ...(person.companyId ? [{ kind: "company" as const, id: person.companyId }] : [])],
    meta: { textId: text.id, status: at > now ? "scheduled" : "queued" },
  });
  await db.crmTextMessage.update({ where: { id: text.id }, data: { activityId } });
  await enqueueJob(db, {
    orgId: organizationId,
    kind: "crm-text-send",
    key: text.id,
    payload: { textId: text.id },
    ...(at > now ? { runAt: at } : {}),
  });
  return { textId: text.id, sendAt: at, waiting: at > now };
}

/** The person whose number this is (the last 10 digits match), if exactly one. */
export async function personByNumber(
  db: TxClient,
  organizationId: string,
  number: string,
): Promise<{ id: string; companyId: string | null; consent: unknown; doNotContact: boolean } | null> {
  const key = phoneKey(number);
  if (!key) return null;
  const rows = await db.crmPerson.findMany({
    where: { organizationId, deletedAt: null, phone: { endsWith: key } },
    select: { id: true, companyId: true, consent: true, doNotContact: true },
    orderBy: { updatedAt: "desc" },
    take: 2,
  });
  return rows[0] ?? null;
}

/**
 * A text that came in (service path, the organization's context): matched
 * to the person by number, STOP/START/HELP applied, on their timeline.
 * Idempotent on the provider's message id.
 */
export async function receiveText(
  db: TxClient,
  organizationId: string,
  input: { provider: "telnyx" | "twilio"; from: string; to: string; body: string; providerMessageId: string | null },
): Promise<{ textId: string; keyword: Keyword; matched: boolean } | null> {
  if (input.providerMessageId) {
    const seen = await db.crmTextMessage.findFirst({
      where: { organizationId, providerMessageId: input.providerMessageId },
      select: { id: true },
    });
    if (seen) return null;
  }
  const from = toE164(input.from) ?? input.from.slice(0, 40);
  const to = toE164(input.to) ?? input.to.slice(0, 40);
  const body = input.body.slice(0, 5_000);
  const person = await personByNumber(db, organizationId, from);
  const keyword = textKeyword(body);
  const text = await db.crmTextMessage.create({
    data: {
      organizationId,
      personId: person?.id ?? null,
      direction: "INBOUND",
      fromNumber: from,
      toNumber: to,
      body,
      provider: input.provider,
      providerMessageId: input.providerMessageId,
      status: "received",
      sentAt: new Date(),
    },
    select: { id: true },
  });
  if (!person) {
    console.info(`[crm:text] a text from ${maskNumber(from)} matched nobody in the CRM`);
    return { textId: text.id, keyword, matched: false };
  }
  if (keyword === "stop" || keyword === "start") {
    const before = readConsent(person.consent).text ?? null;
    const value: ChannelConsent = {
      granted: keyword === "start",
      how: keyword === "start" ? "texted START" : "texted STOP",
      at: new Date().toISOString(),
      by: null,
    };
    // START undoes only the do-not-contact a STOP set, never a member's.
    const dnc = keyword === "stop" ? true : before?.how === "texted STOP" ? false : person.doNotContact;
    await db.crmPerson.update({
      where: { id: person.id },
      data: {
        consent: withConsent(person.consent, "text", value) as Prisma.InputJsonObject,
        doNotContact: dnc,
      },
    });
    await writeHistory(db, {
      organizationId,
      targetKind: "person",
      targetId: person.id,
      changes: [
        { field: "consent.text", oldValue: before, newValue: value },
        ...(dnc !== person.doNotContact ? [{ field: "doNotContact", oldValue: person.doNotContact, newValue: dnc }] : []),
      ],
      userId: null,
      source: "system",
    });
  }
  const activityId = await logActivity(db, {
    organizationId,
    kind: "TEXT",
    direction: "INBOUND",
    subject: keyword === "stop" ? "Texted STOP" : keyword === "start" ? "Texted START" : keyword === "help" ? "Texted HELP" : "Text in",
    body,
    sourceKind: "text",
    sourceId: text.id,
    targets: [{ kind: "person", id: person.id }, ...(person.companyId ? [{ kind: "company" as const, id: person.companyId }] : [])],
    meta: { textId: text.id, keyword },
  });
  await db.crmTextMessage.update({ where: { id: text.id }, data: { activityId } });
  if (!keyword) await queueIssueRefresh(db, organizationId, [person.id], null);
  return { textId: text.id, keyword, matched: true };
}

/** A delivery report from the provider. */
export async function textStatus(
  db: TxClient,
  organizationId: string,
  providerMessageId: string,
  status: string,
): Promise<void> {
  const s = status.toLowerCase().replace(/[^a-z_-]/g, "").slice(0, 30);
  if (!s) return;
  await db.crmTextMessage.updateMany({ where: { organizationId, providerMessageId }, data: { status: s } });
}

/**
 * A number that texted the organization and isn't in the CRM, added as a
 * person in one step (the Calls tab): their number, the name given (or the
 * number), and every text from that number until now moved onto their
 * timeline. A STOP among them is kept: they stay not to be texted.
 */
export async function addTextSender(actor: CrmActor, textId: string, name: string | null): Promise<{ personId: string }> {
  const { db, organizationId } = actor;
  const text = await db.crmTextMessage.findFirst({
    where: { id: textId, organizationId, direction: "INBOUND" },
    select: { id: true, fromNumber: true, personId: true },
  });
  if (!text) throw new CrmError("That text isn't here any more.");
  if (text.personId) return { personId: text.personId };
  const known = await personByNumber(db, organizationId, text.fromNumber);
  const personId =
    known?.id ??
    (
      await createPerson(actor, {
        name: name?.trim().slice(0, 200) || formatNumber(text.fromNumber),
        phone: text.fromNumber,
        source: "text",
        sourceDetail: "Texted the organization's number",
      })
    ).id;
  const person = await db.crmPerson.findFirst({
    where: { id: personId, organizationId },
    select: { id: true, companyId: true, consent: true, doNotContact: true },
  });
  if (!person) throw new CrmError("That person isn't in the CRM any more.");
  const key = phoneKey(text.fromNumber);
  const texts = await db.crmTextMessage.findMany({
    where: { organizationId, direction: "INBOUND", personId: null, ...(key ? { fromNumber: { endsWith: key } } : { id: text.id }) },
    orderBy: { sentAt: "asc" },
    take: 200,
    select: { id: true, body: true, sentAt: true },
  });
  let last: Keyword = null;
  for (const t of texts) {
    const keyword = textKeyword(t.body);
    if (keyword === "stop" || keyword === "start") last = keyword;
    const activityId = await logActivity(db, {
      organizationId,
      kind: "TEXT",
      direction: "INBOUND",
      subject: keyword === "stop" ? "Texted STOP" : keyword === "start" ? "Texted START" : keyword === "help" ? "Texted HELP" : "Text in",
      body: t.body,
      occurredAt: t.sentAt,
      // Added by the member, under their row-level rules (the text itself is from the person).
      createdById: actor.userId,
      sourceKind: "text",
      sourceId: t.id,
      targets: [{ kind: "person", id: person.id }, ...(person.companyId ? [{ kind: "company" as const, id: person.companyId }] : [])],
      meta: { textId: t.id, keyword },
    });
    await db.crmTextMessage.updateMany({ where: { id: t.id, organizationId }, data: { personId: person.id, activityId } });
  }
  if (last === "stop") {
    const value: ChannelConsent = { granted: false, how: "texted STOP", at: new Date().toISOString(), by: null };
    await db.crmPerson.update({
      where: { id: person.id },
      data: { consent: withConsent(person.consent, "text", value) as Prisma.InputJsonObject, doNotContact: true },
    });
  }
  return { personId: person.id };
}
