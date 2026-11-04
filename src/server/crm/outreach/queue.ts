import type { Prisma } from "@/generated/prisma/client";
import { COLD_AFTER_DAYS } from "@/lib/crm/strength";
import { cadenceLapsed } from "@/lib/crm/outreach/schedule";
import type { TxClient } from "@/server/db/context";

import { CrmError, type CrmActor } from "../access";
import { rolesHeldBy, type RoleOwner } from "../owners";

/**
 * Who to reach out to today (docs/features/crm.md, module 5): one row per
 * person (or company), with every reason they're there:
 *
 * - reply: they wrote back and nobody has answered yet;
 * - step: a sequence step waiting on you (a call, a LinkedIn note, a to-do);
 * - followup: their follow-up date is today or past;
 * - new: new from a form this week, nobody in touch yet;
 * - campaign: in your share of an active campaign, not reached yet;
 * - cadence: their keep-in-touch cadence lapsed;
 * - cold: nobody's been in touch for COLD_AFTER_DAYS.
 *
 * "Mine" is what's yours: you or your role own them, the reply came to your
 * mail, the step or the campaign share is yours. A row snoozed in the CRM
 * or the Inbox (InboxItemState "crm:{id}") stays away until it's due. The
 * same rows are the member's Inbox rows.
 */

export type QueueReasonKind = "reply" | "step" | "followup" | "new" | "campaign" | "cadence" | "cold";

export interface QueueReason {
  kind: QueueReasonKind;
  label: string;
  at: Date | null;
  /** The message to answer (reply), the to-do (step), the campaign. */
  ref?: string;
}

export interface QueueItem {
  key: string;
  targetKind: "person" | "company";
  id: string;
  name: string;
  sub: string | null;
  email: string | null;
  phone: string | null;
  doNotContact: boolean;
  unsubscribed: boolean;
  ownerId: string | null;
  lastContactedAt: Date | null;
  /** Their relationship type id (people only). */
  relationship: string | null;
  reasons: QueueReason[];
  urgent: boolean;
}

const RANK: Record<QueueReasonKind, number> = { reply: 0, step: 1, followup: 2, new: 3, campaign: 4, cadence: 5, cold: 6 };

export const REASON_WORDS: Record<QueueReasonKind, string> = {
  reply: "Replies waiting",
  step: "Sequence steps",
  followup: "Follow-ups due",
  new: "New from forms",
  campaign: "Your campaigns",
  cadence: "Keep in touch",
  cold: "Going cold",
};

function endOfDay(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

function days(n: number): number {
  return n * 86_400_000;
}

export interface QueueOptions {
  mine: boolean;
  /** With `mine`: the viewer's team too (the people under them on the org chart). */
  team?: readonly string[];
  /** Only these reasons (the Inbox takes all). */
  limit?: number;
  now?: Date;
}

export async function followUpQueue(
  db: TxClient,
  organizationId: string,
  viewerId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  options: QueueOptions,
): Promise<QueueItem[]> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 60;
  // Whose: the viewer, or the viewer and their team (My team).
  const who = [viewerId, ...(options.team ?? [])];
  const whoIs = who.length === 1 ? viewerId : { in: who };
  const held = who.flatMap((id) => rolesHeldBy(id, roles));
  const ownedBy: Prisma.CrmPersonWhereInput = options.mine
    ? { OR: [{ ownerId: whoIs }, ...(held.length ? [{ ownerRoleKey: { in: held } }] : [])] }
    : {};
  const reasons = new Map<string, QueueReason[]>();
  const add = (id: string, r: QueueReason) => {
    const list = reasons.get(id) ?? [];
    if (!list.some((x) => x.kind === r.kind)) list.push(r);
    reasons.set(id, list);
  };

  // Replies waiting: their last message in a thread came in, nothing went out after.
  const inbound = await db.crmEmailMessage.findMany({
    where: {
      organizationId,
      direction: "INBOUND",
      status: "RECEIVED",
      createdAt: { gte: new Date(now.getTime() - days(21)) },
      ...(options.mine ? { mailboxUserId: whoIs } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, threadId: true, activityId: true, createdAt: true, subject: true },
  });
  // Two reads for all of them: the latest mail out on each thread, and who each message was from.
  const threadIds = [...new Set(inbound.map((m) => m.threadId))];
  const lastOut = new Map(
    (threadIds.length
      ? await db.crmEmailMessage.groupBy({
          by: ["threadId"],
          where: { organizationId, threadId: { in: threadIds }, direction: "OUTBOUND" },
          _max: { createdAt: true },
        })
      : []
    ).map((o) => [o.threadId, o._max.createdAt]),
  );
  const waiting = inbound.filter((m) => {
    const out = lastOut.get(m.threadId);
    return m.activityId && !(out && out > m.createdAt);
  });
  const from = new Map<string, string>();
  if (waiting.length) {
    const links = await db.crmActivityTarget.findMany({
      where: { organizationId, activityId: { in: waiting.map((m) => m.activityId!) }, targetKind: "person" },
      select: { activityId: true, targetId: true },
    });
    for (const l of links) if (!from.has(l.activityId)) from.set(l.activityId, l.targetId);
  }
  for (const m of waiting) {
    const personId = from.get(m.activityId!);
    if (personId) add(personId, { kind: "reply", label: m.subject ? `Replied: ${m.subject}` : "Replied", at: m.createdAt, ref: m.id });
  }

  // Sequence steps waiting on someone.
  const steps = await db.crmActivity.findMany({
    where: {
      organizationId,
      kind: "SEQUENCE_STEP",
      deletedAt: null,
      meta: { path: ["open"], equals: true },
      occurredAt: { lte: now },
      ...(options.mine ? { actorId: whoIs } : {}),
    },
    orderBy: { occurredAt: "asc" },
    take: 100,
    select: { id: true, subject: true, occurredAt: true, targets: { where: { targetKind: "person" }, select: { targetId: true } } },
  });
  for (const s of steps) {
    const pid = s.targets[0]?.targetId;
    if (pid) add(pid, { kind: "step", label: s.subject ?? "A sequence step", at: s.occurredAt, ref: s.id });
  }

  // Follow-ups due.
  const due = await db.crmPerson.findMany({
    where: { organizationId, deletedAt: null, status: { not: "INACTIVE" }, nextFollowUpAt: { lte: endOfDay(now) }, ...ownedBy },
    orderBy: { nextFollowUpAt: "asc" },
    take: 100,
    select: { id: true, nextFollowUpAt: true },
  });
  for (const p of due) {
    const overdue = p.nextFollowUpAt!.getTime() < now.getTime() - days(1);
    add(p.id, { kind: "followup", label: overdue ? "Follow-up overdue" : "Follow up today", at: p.nextFollowUpAt });
  }

  // New from forms this week, nobody in touch yet.
  const fresh = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      lastContactedAt: null,
      createdAt: { gte: new Date(now.getTime() - days(7)) },
      source: { in: ["form", "forms", "booking"] },
      ...(options.mine ? { OR: [{ ownerId: whoIs }, { ownerId: null, ownerRoleKey: null }, ...(held.length ? [{ ownerRoleKey: { in: held } }] : [])] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, createdAt: true, sourceDetail: true },
  });
  for (const p of fresh) add(p.id, { kind: "new", label: p.sourceDetail ? `New from ${p.sourceDetail}` : "New this week", at: p.createdAt });

  // Your campaign shares.
  const targets = await db.crmCampaignTarget.findMany({
    where: {
      organizationId,
      status: "TODO",
      campaign: { status: "ACTIVE" },
      ...(options.mine ? { assigneeId: whoIs } : { assigneeId: { not: null } }),
    },
    orderBy: { campaign: { dueOn: { sort: "asc", nulls: "last" } } },
    take: 150,
    select: { personId: true, campaign: { select: { id: true, name: true, dueOn: true } } },
  });
  for (const t of targets) {
    add(t.personId, {
      kind: "campaign",
      label: t.campaign.dueOn
        ? `${t.campaign.name}, by ${t.campaign.dueOn.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`
        : t.campaign.name,
      at: t.campaign.dueOn,
      ref: t.campaign.id,
    });
  }

  // Keep in touch and going cold.
  const lapsing = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { in: ["ACTIVE", "ALUMNI"] },
      doNotContact: false,
      OR: [
        { keepInTouchDays: { not: null } },
        { lastContactedAt: { lt: new Date(now.getTime() - days(COLD_AFTER_DAYS)), not: null } },
      ],
      // Theirs too, without replacing the OR above.
      AND: [ownedBy],
    },
    orderBy: { strength: "desc" },
    take: 300,
    select: { id: true, lastContactedAt: true, keepInTouchDays: true },
  });
  for (const p of lapsing) {
    if (p.keepInTouchDays) {
      if (cadenceLapsed(p.lastContactedAt, p.keepInTouchDays, now)) {
        add(p.id, { kind: "cadence", label: `Every ${p.keepInTouchDays} days: time to check in`, at: p.lastContactedAt });
      }
    } else if (p.lastContactedAt && now.getTime() - p.lastContactedAt.getTime() > days(COLD_AFTER_DAYS)) {
      add(p.id, { kind: "cold", label: "Going cold", at: p.lastContactedAt });
    }
  }

  // Snoozed rows stay away.
  const snoozed = await db.inboxItemState.findMany({
    where: { organizationId, userId: viewerId, itemKey: { startsWith: "crm:" }, snoozedUntil: { gt: now } },
    select: { itemKey: true },
  });
  const away = new Set(snoozed.map((s) => s.itemKey.slice(4)));
  const ids = [...reasons.keys()].filter((id) => !away.has(id));
  const people = ids.length
    ? await db.crmPerson.findMany({
        where: { organizationId, id: { in: ids }, deletedAt: null },
        select: {
          id: true,
          name: true,
          title: true,
          primaryEmail: true,
          phone: true,
          doNotContact: true,
          unsubscribedAt: true,
          ownerId: true,
          lastContactedAt: true,
          relationship: true,
          company: { select: { name: true } },
        },
      })
    : [];
  const items: QueueItem[] = people.map((p) => {
    const rs = (reasons.get(p.id) ?? []).sort((a, b) => RANK[a.kind] - RANK[b.kind]);
    return {
      key: `crm:${p.id}`,
      targetKind: "person",
      id: p.id,
      name: p.name,
      sub: [p.title, p.company?.name].filter(Boolean).join(", ") || null,
      email: p.primaryEmail,
      phone: p.phone,
      doNotContact: p.doNotContact,
      unsubscribed: Boolean(p.unsubscribedAt),
      ownerId: p.ownerId,
      lastContactedAt: p.lastContactedAt,
      relationship: p.relationship,
      reasons: rs,
      urgent: rs.some((r) => r.kind === "reply" || r.kind === "step" || (r.kind === "followup" && r.label.includes("overdue"))),
    };
  });

  // Companies with a follow-up due.
  const companies = await db.crmCompany.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { not: "INACTIVE" },
      nextFollowUpAt: { lte: endOfDay(now) },
      ...(options.mine ? { OR: [{ ownerId: whoIs }, ...(held.length ? [{ ownerRoleKey: { in: held } }] : [])] } : {}),
    },
    orderBy: { nextFollowUpAt: "asc" },
    take: 20,
    select: { id: true, name: true, domain: true, phone: true, ownerId: true, lastContactedAt: true, nextFollowUpAt: true },
  });
  for (const c of companies) {
    if (away.has(c.id)) continue;
    items.push({
      key: `crm:${c.id}`,
      targetKind: "company",
      id: c.id,
      name: c.name,
      sub: c.domain,
      email: null,
      phone: c.phone,
      doNotContact: false,
      unsubscribed: false,
      ownerId: c.ownerId,
      lastContactedAt: c.lastContactedAt,
      relationship: null,
      reasons: [{ kind: "followup", label: "Follow up today", at: c.nextFollowUpAt }],
      urgent: false,
    });
  }
  return items
    .sort((a, b) => RANK[a.reasons[0]!.kind] - RANK[b.reasons[0]!.kind] || (a.reasons[0]!.at?.getTime() ?? 0) - (b.reasons[0]!.at?.getTime() ?? 0))
    .slice(0, limit);
}

/** Snoozes a queue row for the viewer (the Inbox's snooze, the same row). */
export async function snoozeQueueItem(actor: CrmActor, id: string, until: Date): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new CrmError("That isn't in your queue.");
  if (until.getTime() <= Date.now()) throw new CrmError("Pick a time to come back.");
  const { db, organizationId, userId } = actor;
  const itemKey = `crm:${id}`;
  await db.inboxItemState.upsert({
    where: { userId_organizationId_itemKey: { userId, organizationId, itemKey } },
    create: { userId, organizationId, itemKey, snoozedUntil: until },
    update: { snoozedUntil: until, doneAt: null, updatedAt: new Date() },
    select: { itemKey: true },
  });
}

