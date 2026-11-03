import { formatMoney } from "@/lib/crm/fields";
import { normalizeEmail } from "@/lib/crm/dedupe";
import type { TxClient } from "@/server/db/context";

import { logActivity, type ActivityTarget } from "./activity";

/**
 * The timeline fills itself from the workspace (docs/features/crm.md,
 * module 3 and "What makes ours better" 1): meetings and events a person
 * attends, RSVPs, check-ins, form responses, tasks, notes and meetings
 * linked to a record, and Finance payments from a partner's deal. Each source row
 * becomes one CrmActivity keyed by sourceKind/sourceId (unique per
 * organization), so mirroring again only adds what's new: a second run
 * over the same rows writes nothing but the targets it didn't have.
 *
 * People are matched by member account (userId), workspace contact
 * (contactId) and every address they have (CrmPersonEmail). Runs on the
 * service path inside one organization (the crm-refresh job), in turns of
 * TURN rows per source so a big organization finishes over a few runs.
 */

export const TURN = 300;
/** How far back the first mirror reaches. */
export const MIRROR_DAYS = 730;

export interface PeopleIndex {
  byUser: Map<string, string[]>;
  byContact: Map<string, string[]>;
  byEmail: Map<string, string>;
  companyOf: Map<string, string | null>;
}

function push(map: Map<string, string[]>, key: string | null, value: string) {
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Who's who, for matching workspace rows to people (optionally one person only). */
export async function peopleIndex(
  db: TxClient,
  organizationId: string,
  personId?: string,
): Promise<PeopleIndex> {
  const people = await db.crmPerson.findMany({
    where: { organizationId, deletedAt: null, ...(personId ? { id: personId } : {}) },
    select: { id: true, userId: true, contactId: true, companyId: true, emails: { select: { email: true } } },
    take: 100_000,
  });
  const index: PeopleIndex = { byUser: new Map(), byContact: new Map(), byEmail: new Map(), companyOf: new Map() };
  for (const p of people) {
    push(index.byUser, p.userId, p.id);
    push(index.byContact, p.contactId, p.id);
    for (const e of p.emails) index.byEmail.set(e.email, p.id);
    index.companyOf.set(p.id, p.companyId);
  }
  return index;
}

function targetsFor(index: PeopleIndex, personIds: readonly string[]): ActivityTarget[] {
  const out: ActivityTarget[] = [];
  for (const id of new Set(personIds)) {
    out.push({ kind: "person", id });
    const company = index.companyOf.get(id);
    if (company) out.push({ kind: "company", id: company });
  }
  return out;
}

/** The sourceIds of a kind already mirrored, among `ids`. */
async function mirrored(db: TxClient, organizationId: string, sourceKind: string, ids: readonly string[]) {
  if (ids.length === 0) return new Set<string>();
  const rows = await db.crmActivity.findMany({
    where: { organizationId, sourceKind, sourceId: { in: [...ids] } },
    select: { sourceId: true },
  });
  return new Set(rows.map((r) => r.sourceId!));
}

export interface MirrorResult {
  written: number;
  /** A source had more than one turn's worth: run again. */
  more: boolean;
}

export async function mirrorWorkspace(
  db: TxClient,
  organizationId: string,
  options: { personId?: string; now?: Date } = {},
): Promise<MirrorResult> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - MIRROR_DAYS * 86_400_000);
  const index = await peopleIndex(db, organizationId, options.personId);
  const userIds = [...index.byUser.keys()];
  const contactIds = [...index.byContact.keys()];
  const emails = [...index.byEmail.keys()];
  let written = 0;
  let more = false;

  // ---- Meetings and events a person attends (one activity per event).
  if (userIds.length > 0) {
    const rows = await db.eventAttendee.findMany({
      where: {
        organizationId,
        userId: { in: userIds },
        rsvp: { not: "NO" },
        event: { deletedAt: null, startsAt: { gte: since, lte: new Date(now.getTime() + 30 * 86_400_000) } },
      },
      select: {
        userId: true,
        event: { select: { id: true, title: true, startsAt: true, kind: true, meetingType: true } },
      },
      orderBy: { event: { startsAt: "desc" } },
      take: TURN * 4,
    });
    const byEvent = new Map<string, { event: (typeof rows)[number]["event"]; people: string[] }>();
    for (const r of rows) {
      const e = byEvent.get(r.event.id) ?? { event: r.event, people: [] };
      e.people.push(...(index.byUser.get(r.userId) ?? []));
      byEvent.set(r.event.id, e);
    }
    for (const { event, people } of byEvent.values()) {
      await logActivity(db, {
        organizationId,
        kind: "MEETING",
        subject: event.title,
        occurredAt: event.startsAt,
        targets: targetsFor(index, people),
        sourceKind: "event",
        sourceId: event.id,
        meta: { eventKind: event.kind, meetingType: event.meetingType },
      });
      written++;
    }
  }

  // ---- RSVPs on event pages (by address).
  if (emails.length > 0) {
    const regs = await db.eventRegistration.findMany({
      where: { organizationId, email: { in: emails, mode: "insensitive" }, createdAt: { gte: since } },
      select: {
        id: true,
        email: true,
        status: true,
        createdAt: true,
        checkedInAt: true,
        event: { select: { id: true, title: true, startsAt: true } },
      },
      orderBy: { createdAt: "desc" },
      take: TURN + 1,
    });
    more ||= regs.length > TURN;
    const done = await mirrored(db, organizationId, "rsvp", regs.map((r) => r.id));
    for (const r of regs.slice(0, TURN)) {
      if (done.has(r.id)) continue;
      const personId = index.byEmail.get(normalizeEmail(r.email) ?? "");
      if (!personId) continue;
      await logActivity(db, {
        organizationId,
        kind: "RSVP",
        subject: `RSVP'd to ${r.event.title}`,
        occurredAt: r.createdAt,
        targets: targetsFor(index, [personId]),
        sourceKind: "rsvp",
        sourceId: r.id,
        meta: { eventId: r.event.id, status: r.status, checkedIn: Boolean(r.checkedInAt) },
      });
      written++;
    }
  }

  // ---- Check-ins (through the workspace contact).
  if (contactIds.length > 0) {
    const rows = await db.attendance.findMany({
      where: {
        organizationId,
        contactId: { in: contactIds },
        suppressedAt: null,
        checkedInAt: { gte: since },
      },
      select: { id: true, contactId: true, checkedInAt: true, event: { select: { id: true, title: true } } },
      orderBy: { checkedInAt: "desc" },
      take: TURN + 1,
    });
    more ||= rows.length > TURN;
    const done = await mirrored(db, organizationId, "check-in", rows.map((r) => r.id));
    for (const r of rows.slice(0, TURN)) {
      if (done.has(r.id)) continue;
      const people = index.byContact.get(r.contactId) ?? [];
      if (people.length === 0) continue;
      await logActivity(db, {
        organizationId,
        kind: "CHECK_IN",
        subject: `Checked in at ${r.event.title}`,
        occurredAt: r.checkedInAt,
        targets: targetsFor(index, people),
        sourceKind: "check-in",
        sourceId: r.id,
        meta: { eventId: r.event.id },
      });
      written++;
    }
  }

  // ---- Form responses (by address or member account).
  if (emails.length > 0 || userIds.length > 0) {
    const rows = await db.formResponse.findMany({
      where: {
        organizationId,
        createdAt: { gte: since },
        OR: [
          ...(emails.length ? [{ email: { in: emails, mode: "insensitive" as const } }] : []),
          ...(userIds.length ? [{ userId: { in: userIds } }] : []),
        ],
      },
      select: { id: true, email: true, userId: true, createdAt: true, form: { select: { id: true, title: true } } },
      orderBy: { createdAt: "desc" },
      take: TURN + 1,
    });
    more ||= rows.length > TURN;
    const done = await mirrored(db, organizationId, "form-response", rows.map((r) => r.id));
    for (const r of rows.slice(0, TURN)) {
      if (done.has(r.id)) continue;
      const people = [
        ...(r.userId ? (index.byUser.get(r.userId) ?? []) : []),
        ...(r.email && index.byEmail.get(normalizeEmail(r.email) ?? "") ? [index.byEmail.get(normalizeEmail(r.email)!)!] : []),
      ];
      if (people.length === 0) continue;
      await logActivity(db, {
        organizationId,
        kind: "FORM_RESPONSE",
        subject: `Answered ${r.form.title}`,
        occurredAt: r.createdAt,
        targets: targetsFor(index, people),
        sourceKind: "form-response",
        sourceId: r.id,
        meta: { formId: r.form.id },
      });
      written++;
    }
  }

  // ---- Tasks, notes and meetings linked to a CRM record (ItemLink, either way).
  if (!options.personId) {
    written += await mirrorLinks(db, organizationId, since);
    written += await mirrorPayments(db, organizationId, since);
  }
  return { written, more };
}

const CRM_KINDS = { "crm-person": "person", "crm-company": "company", "crm-deal": "deal" } as const;
type CrmLinkKind = keyof typeof CRM_KINDS;

async function mirrorLinks(db: TxClient, organizationId: string, since: Date): Promise<number> {
  const links = await db.itemLink.findMany({
    where: {
      organizationId,
      createdAt: { gte: since },
      OR: [{ fromKind: { in: Object.keys(CRM_KINDS) } }, { toKind: { in: Object.keys(CRM_KINDS) } }],
    },
    select: { id: true, fromKind: true, fromId: true, toKind: true, toId: true, createdAt: true, createdById: true },
    orderBy: { createdAt: "desc" },
    take: TURN,
  });
  let written = 0;
  for (const l of links) {
    const crmSide = l.fromKind in CRM_KINDS ? { kind: l.fromKind, id: l.fromId } : { kind: l.toKind, id: l.toId };
    const other = crmSide.kind === l.fromKind && crmSide.id === l.fromId ? { kind: l.toKind, id: l.toId } : { kind: l.fromKind, id: l.fromId };
    if (other.kind in CRM_KINDS) continue;
    const target = { kind: CRM_KINDS[crmSide.kind as CrmLinkKind], id: crmSide.id };
    let subject: string | null = null;
    let kind: "TASK" | "NOTE" | "MEETING" | "PAYMENT" | "SYSTEM" = "SYSTEM";
    let occurredAt = l.createdAt;
    if (other.kind === "task") {
      const t = await db.task.findFirst({
        where: { id: other.id, organizationId, deletedAt: null },
        select: { title: true, status: true },
      });
      if (!t) continue;
      kind = "TASK";
      subject = t.status === "COMPLETED" ? `Done: ${t.title}` : t.title;
    } else if (other.kind === "note") {
      const nt = await db.note.findFirst({
        where: { id: other.id, organizationId, deletedAt: null },
        select: { title: true },
      });
      if (!nt) continue;
      kind = "NOTE";
      subject = nt.title || "A note";
    } else if (other.kind === "event") {
      const e = await db.event.findFirst({
        where: { id: other.id, organizationId, deletedAt: null },
        select: { title: true, startsAt: true },
      });
      if (!e) continue;
      kind = "MEETING";
      subject = e.title;
      occurredAt = e.startsAt;
    } else {
      continue;
    }
    await logActivity(db, {
      organizationId,
      kind,
      subject,
      occurredAt,
      targets: [target],
      actorId: l.createdById,
      sourceKind: "link",
      sourceId: l.id,
      meta: { linkedKind: other.kind, linkedId: other.id },
    });
    written++;
  }
  return written;
}

/** Deal payments in Finance (Sponsorship rows), on the partner's company (and the item). */
async function mirrorPayments(db: TxClient, organizationId: string, since: Date): Promise<number> {
  const rows = await db.sponsorship.findMany({
    where: { organizationId, transactionId: { not: null }, transaction: { voidedAt: null, occurredAt: { gte: since } } },
    select: {
      id: true,
      sponsorId: true,
      transaction: { select: { id: true, amountCents: true, occurredAt: true, description: true } },
    },
    take: TURN,
  });
  if (rows.length === 0) return 0;
  const done = await mirrored(db, organizationId, "transaction", rows.map((r) => r.transaction!.id));
  let written = 0;
  for (const r of rows) {
    const t = r.transaction!;
    if (done.has(t.id)) continue;
    const company = await db.crmCompany.findFirst({
      where: { organizationId, sponsorId: r.sponsorId },
      select: { id: true },
    });
    const deal = await db.crmDeal.findFirst({
      where: { organizationId, sponsorshipId: r.id },
      select: { id: true },
    });
    if (!company && !deal) continue;
    await logActivity(db, {
      organizationId,
      kind: "PAYMENT",
      subject: `Paid ${formatMoney(t.amountCents)}`,
      body: t.description,
      occurredAt: t.occurredAt,
      targets: [
        ...(company ? [{ kind: "company" as const, id: company.id }] : []),
        ...(deal ? [{ kind: "deal" as const, id: deal.id }] : []),
      ],
      sourceKind: "transaction",
      sourceId: t.id,
      meta: { amountCents: t.amountCents },
    });
    written++;
  }
  return written;
}
