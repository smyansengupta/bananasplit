import type { CrmTargetStatus } from "@/generated/prisma/client";
import { appUrl } from "@/lib/app-url";
import { campaignNumbers, splitAmong, type CampaignNumbers } from "@/lib/crm/outreach/assign";
import { normalizeEmail } from "@/lib/crm/dedupe";
import { crmPlanHref } from "@/lib/crm/href";
import type { TxClient } from "@/server/db/context";
import { enqueueJob } from "@/server/jobs/enqueue";
import { notifyUsers } from "@/server/notifications";

import { CrmError, requireMember, type CrmActor } from "../access";
import type { RoleOwner } from "../owners";
import { listPeople } from "./lists";
import { contactable, queueEmail, renderFor } from "./send";
import { enroll } from "./sequences";

/**
 * Campaigns (docs/features/crm.md, module 5): a list plus a goal and a due
 * date ("reach all 200 alumni by Friday"), and how to reach them: a
 * template each member sends from their own mailbox (with a preview and
 * per-person edits), a sequence, an invite to an event or a form. The list
 * is split among members, each gets their share in their queue, and the
 * numbers that matter are counted: contacted, replied, booked, converted.
 *
 * `channel`: "email" (a template), "sequence", "event" (eventId), "form:{id}",
 * "call", or "bulk" (bulk.ts; one email to everyone from the
 * organization's sender).
 */

export interface CampaignInput {
  name: string;
  goal?: string | null;
  goalCount?: number | null;
  dueOn?: string | null;
  viewId: string;
  channel: "email" | "sequence" | "event" | "form" | "call";
  templateId?: string | null;
  sequenceId?: string | null;
  eventId?: string | null;
  formId?: string | null;
  /** Who shares it (the creator alone when empty). */
  memberIds?: string[];
}

export function formOf(channel: string): string | null {
  return channel.startsWith("form:") ? channel.slice(5) : null;
}

export async function createCampaign(
  actor: CrmActor,
  input: CampaignInput,
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<{ id: string; people: number }> {
  const { db, organizationId, userId } = actor;
  // Splitting a list among members needs members: a Personal space has one.
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { kind: true } });
  if (org?.kind === "PERSONAL") {
    throw new CrmError("Splitting a list is for organizations. Here it's just you: email them instead.");
  }
  const name = input.name.trim().slice(0, 120);
  if (!name) throw new CrmError("Give the campaign a name.", ["name"]);
  const dueOn = input.dueOn ? new Date(`${input.dueOn}T12:00:00Z`) : null;
  if (dueOn && Number.isNaN(dueOn.getTime())) throw new CrmError("Pick a real date.", ["dueOn"]);
  let channel: string = input.channel;
  if (input.channel === "email") {
    if (!input.templateId) throw new CrmError("Pick a template.", ["templateId"]);
    const t = await db.crmTemplate.findFirst({ where: { id: input.templateId, organizationId, archivedAt: null }, select: { id: true } });
    if (!t) throw new CrmError("That template isn't here any more.");
  }
  if (input.channel === "sequence") {
    const s = await db.crmSequence.findFirst({ where: { id: input.sequenceId ?? "", organizationId, archivedAt: null }, select: { status: true } });
    if (!s) throw new CrmError("Pick a sequence.", ["sequenceId"]);
    if (s.status !== "ON") throw new CrmError("Turn the sequence on first.");
  }
  if (input.channel === "event") {
    const e = await db.event.findFirst({
      where: { id: input.eventId ?? "", organizationId, deletedAt: null },
      select: { id: true, rsvpSlug: true },
    });
    if (!e) throw new CrmError("Pick an event.", ["eventId"]);
  }
  if (input.channel === "form") {
    const f = await db.form.findFirst({ where: { id: input.formId ?? "", organizationId, deletedAt: null }, select: { id: true } });
    if (!f) throw new CrmError("Pick a form.", ["formId"]);
    channel = `form:${f.id}`;
  }
  const memberIds = [...new Set(input.memberIds?.length ? input.memberIds : [userId])].slice(0, 100);
  for (const m of memberIds) await requireMember(db, organizationId, m);
  const people = await listPeople(db, organizationId, input.viewId, userId, roles, 2000);
  if (people.length === 0) throw new CrmError("Nobody is on that list yet.");
  const campaign = await db.crmCampaign.create({
    data: {
      organizationId,
      name,
      goal: input.goal?.trim().slice(0, 300) || null,
      goalCount: input.goalCount && input.goalCount > 0 ? Math.min(input.goalCount, 100_000) : null,
      dueOn,
      viewId: input.viewId,
      templateId: input.channel === "email" ? input.templateId! : null,
      sequenceId: input.channel === "sequence" ? input.sequenceId! : null,
      eventId: input.channel === "event" ? input.eventId! : null,
      channel,
      status: "ACTIVE",
      createdById: userId,
    },
    select: { id: true },
  });
  await addTargets(db, organizationId, campaign.id, people, memberIds);
  await tellAssignees(db, organizationId, campaign.id, name, userId);
  return { id: campaign.id, people: people.length };
}

async function addTargets(
  db: TxClient,
  organizationId: string,
  campaignId: string,
  people: readonly { id: string; ownerId: string | null }[],
  memberIds: readonly string[],
): Promise<number> {
  const existing = await db.crmCampaignTarget.findMany({
    where: { organizationId, campaignId },
    select: { personId: true, assigneeId: true },
  });
  const have = new Set(existing.map((e) => e.personId));
  const load = new Map<string, number>();
  for (const e of existing) if (e.assigneeId) load.set(e.assigneeId, (load.get(e.assigneeId) ?? 0) + 1);
  const fresh = people.filter((p) => !have.has(p.id));
  const split = splitAmong(fresh, memberIds, load);
  await db.crmCampaignTarget.createMany({
    data: fresh.map((p) => ({ organizationId, campaignId, personId: p.id, assigneeId: split.get(p.id) ?? null })),
    skipDuplicates: true,
  });
  return fresh.length;
}

async function tellAssignees(db: TxClient, organizationId: string, campaignId: string, name: string, actorId: string) {
  const counts = await db.crmCampaignTarget.groupBy({
    by: ["assigneeId"],
    where: { organizationId, campaignId, status: "TODO", assigneeId: { not: null } },
    _count: { _all: true },
  });
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  for (const c of counts) {
    if (!c.assigneeId || c.assigneeId === actorId) continue;
    await notifyUsers(db, organizationId, [c.assigneeId], {
      type: "CRM_ASSIGNED",
      title: `${c._count._all} ${c._count._all === 1 ? "person" : "people"} to reach in ${name}`,
      body: "They're in your queue on the CRM's home.",
      linkUrl: org ? crmPlanHref(org.slug, "campaign", campaignId) : null,
      actorId,
      dedupeKey: `crm-campaign:${campaignId}:${c.assigneeId}:${c._count._all}`,
    });
  }
}

/** Adds whoever has joined the list since, split among the same members. */
export async function refreshFromList(actor: CrmActor, campaignId: string, roles: ReadonlyMap<string, RoleOwner>): Promise<number> {
  const { db, organizationId, userId } = actor;
  const c = await db.crmCampaign.findFirst({ where: { id: campaignId, organizationId }, select: { viewId: true, name: true } });
  if (!c?.viewId) throw new CrmError("This campaign has no list.");
  const members = await db.crmCampaignTarget.findMany({
    where: { organizationId, campaignId, assigneeId: { not: null } },
    distinct: ["assigneeId"],
    select: { assigneeId: true },
  });
  const ids = members.map((m) => m.assigneeId!).filter(Boolean);
  const added = await addTargets(db, organizationId, campaignId, await listPeople(db, organizationId, c.viewId, userId, roles), ids.length ? ids : [userId]);
  if (added) await tellAssignees(db, organizationId, campaignId, c.name, userId);
  return added;
}

export async function setTargetStatus(actor: CrmActor, targetId: string, status: CrmTargetStatus): Promise<void> {
  const res = await actor.db.crmCampaignTarget.updateMany({
    where: { id: targetId, organizationId: actor.organizationId },
    data: { status, ...(status === "CONTACTED" ? { contactedAt: new Date() } : {}) },
  });
  if (res.count === 0) throw new CrmError("They're not in this campaign any more.");
}

export async function setCampaignStatus(actor: CrmActor, campaignId: string, status: "ACTIVE" | "DONE" | "ARCHIVED"): Promise<void> {
  const res = await actor.db.crmCampaign.updateMany({ where: { id: campaignId, organizationId: actor.organizationId }, data: { status } });
  if (res.count === 0) throw new CrmError("That campaign isn't here any more.");
}

/** The link an invite sends: the event's RSVP page or the form. */
export async function inviteLink(db: TxClient, organizationId: string, channel: string, eventId: string | null): Promise<string | null> {
  if (eventId) {
    const e = await db.event.findFirst({ where: { id: eventId, organizationId }, select: { rsvpSlug: true, rsvpEnabled: true } });
    return e?.rsvpSlug && e.rsvpEnabled ? appUrl(`/e/${e.rsvpSlug}`) : null;
  }
  const formId = formOf(channel);
  if (formId) {
    const f = await db.form.findFirst({ where: { id: formId, organizationId }, select: { slug: true } });
    return f?.slug ? appUrl(`/f/${f.slug}`) : null;
  }
  return null;
}

export interface ShareItem {
  targetId: string;
  subject: string;
  body: string;
}

/**
 * Sends the member's edited messages to their share (an email or invite
 * campaign), each from their own mailbox. Each item was previewed and may
 * have been edited for that one person.
 */
export async function sendShare(actor: CrmActor, campaignId: string, items: readonly ShareItem[]): Promise<{ queued: number; skipped: string[] }> {
  const { db, organizationId, userId } = actor;
  if (items.length === 0) throw new CrmError("Pick who to send to.");
  if (items.length > 200) throw new CrmError("Up to 200 at a time.");
  const c = await db.crmCampaign.findFirst({
    where: { id: campaignId, organizationId, status: "ACTIVE" },
    select: { id: true, templateId: true },
  });
  if (!c) throw new CrmError("That campaign isn't running.");
  const targets = await db.crmCampaignTarget.findMany({
    where: { organizationId, campaignId, id: { in: items.map((i) => i.targetId) } },
    select: { id: true, personId: true, status: true, assigneeId: true, person: { select: { name: true } } },
  });
  const skipped: string[] = [];
  let queued = 0;
  for (const item of items) {
    const t = targets.find((x) => x.id === item.targetId);
    if (!t) continue;
    if (t.status !== "TODO") {
      skipped.push(`${t.person.name}: already reached`);
      continue;
    }
    try {
      // Merge fields left in an edit still fill in.
      const r = await renderFor(db, organizationId, t.personId, userId, item);
      await queueEmail(db, {
        organizationId,
        senderId: userId,
        createdById: userId,
        personId: t.personId,
        subject: r.subject,
        body: r.body,
        templateId: c.templateId,
        campaignId,
      });
      if (t.assigneeId !== userId) await db.crmCampaignTarget.update({ where: { id: t.id }, data: { assigneeId: userId } });
      queued++;
    } catch (error) {
      if (error instanceof CrmError) skipped.push(`${t.person.name}: ${error.message}`);
      else throw error;
    }
  }
  return { queued, skipped };
}

/** Enrolls the member's share in the campaign's sequence, from their mailbox. */
export async function enrollShare(actor: CrmActor, campaignId: string) {
  const { db, organizationId, userId } = actor;
  const c = await db.crmCampaign.findFirst({
    where: { id: campaignId, organizationId, status: "ACTIVE" },
    select: { sequenceId: true },
  });
  if (!c?.sequenceId) throw new CrmError("This campaign has no sequence.");
  const mine = await db.crmCampaignTarget.findMany({
    where: { organizationId, campaignId, assigneeId: userId, status: "TODO" },
    select: { id: true, personId: true },
    take: 500,
  });
  if (mine.length === 0) throw new CrmError("Nobody in your share is waiting.");
  const r = await enroll(actor, c.sequenceId, mine.map((m) => m.personId), { campaignId });
  const skippedIds = new Set(r.skipped.map((s) => s.personId));
  await db.crmCampaignTarget.updateMany({
    where: { organizationId, id: { in: mine.filter((m) => !skippedIds.has(m.personId)).map((m) => m.id) } },
    data: { status: "CONTACTED", contactedAt: new Date() },
  });
  return r;
}

// ---- Numbers -----------------------------------------------------------------------

export interface CampaignProgress extends CampaignNumbers {
  byMember: { userId: string | null; total: number; contacted: number; replied: number }[];
}

/**
 * The campaign's numbers. Converted comes from what happened in the
 * workspace: an RSVP to its event, an answer to its form, or (for any
 * campaign) an item won with them since it started.
 */
export async function campaignProgress(db: TxClient, organizationId: string, campaignId: string): Promise<CampaignProgress> {
  const c = await db.crmCampaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { createdAt: true, eventId: true, channel: true },
  });
  const targets = await db.crmCampaignTarget.findMany({
    where: { organizationId, campaignId },
    select: { personId: true, status: true, assigneeId: true, person: { select: { primaryEmail: true, userId: true } } },
  });
  const converted = c ? await convertedPeople(db, organizationId, c, targets) : new Set<string>();
  return progressOf(targets, converted);
}

/**
 * campaignProgress for many campaigns at once (the plans list): one read
 * of their people and one of the deals won with them; an event's RSVPs or
 * a form's answers are read only for the campaigns that have one.
 */
export async function campaignsProgress(
  db: TxClient,
  organizationId: string,
  campaigns: readonly { id: string; createdAt: Date; eventId: string | null; channel: string }[],
): Promise<Map<string, CampaignProgress>> {
  const out = new Map<string, CampaignProgress>();
  if (campaigns.length === 0) return out;
  const targets = await db.crmCampaignTarget.findMany({
    where: { organizationId, campaignId: { in: campaigns.map((c) => c.id) } },
    select: {
      campaignId: true,
      personId: true,
      status: true,
      assigneeId: true,
      person: { select: { primaryEmail: true, userId: true } },
    },
  });
  const since = new Date(Math.min(...campaigns.map((c) => c.createdAt.getTime())));
  const personIds = [...new Set(targets.map((t) => t.personId))];
  const won = personIds.length
    ? (
        await db.crmDealPerson.findMany({
          where: {
            organizationId,
            personId: { in: personIds },
            deal: { deletedAt: null, closedAt: { gte: since }, stage: { kind: "WON" } },
          },
          select: { personId: true, deal: { select: { closedAt: true } } },
        })
      ).map((w) => ({ personId: w.personId, closedAt: w.deal.closedAt }))
    : [];
  for (const c of campaigns) {
    const mine = targets.filter((t) => t.campaignId === c.id);
    out.set(c.id, progressOf(mine, await convertedPeople(db, organizationId, c, mine, won)));
  }
  return out;
}

function progressOf(
  targets: readonly { personId: string; status: CrmTargetStatus; assigneeId: string | null }[],
  converted: ReadonlySet<string>,
): CampaignProgress {
  const statuses = targets.map((t) => (converted.has(t.personId) && t.status !== "SKIPPED" ? ("CONVERTED" as const) : t.status));
  const byMember = new Map<string | null, { total: number; contacted: number; replied: number }>();
  targets.forEach((t, i) => {
    const m = byMember.get(t.assigneeId) ?? { total: 0, contacted: 0, replied: 0 };
    m.total++;
    const s = statuses[i]!;
    if (s !== "TODO" && s !== "SKIPPED") m.contacted++;
    if (s === "REPLIED" || s === "BOOKED" || s === "CONVERTED") m.replied++;
    byMember.set(t.assigneeId, m);
  });
  return { ...campaignNumbers(statuses), byMember: [...byMember.entries()].map(([userId, v]) => ({ userId, ...v })) };
}

async function convertedPeople(
  db: TxClient,
  organizationId: string,
  c: { createdAt: Date; eventId: string | null; channel: string },
  targets: readonly { personId: string; person: { primaryEmail: string | null; userId: string | null } }[],
  /** Deals already read for many campaigns (campaignsProgress); else they're read here. */
  wonAlready?: readonly { personId: string; closedAt: Date | null }[],
): Promise<Set<string>> {
  const out = new Set<string>();
  const byEmail = new Map<string, string>();
  for (const t of targets) {
    const e = normalizeEmail(t.person.primaryEmail);
    if (e) byEmail.set(e, t.personId);
  }
  if (c.eventId && byEmail.size) {
    const regs = await db.eventRegistration.findMany({
      where: { organizationId, eventId: c.eventId, status: { not: "CANCELLED" }, email: { in: [...byEmail.keys()] } },
      select: { email: true },
    });
    for (const r of regs) out.add(byEmail.get(r.email.toLowerCase())!);
  }
  const formId = formOf(c.channel);
  if (formId && byEmail.size) {
    const rs = await db.formResponse.findMany({
      where: { organizationId, formId, createdAt: { gte: c.createdAt }, email: { in: [...byEmail.keys()], mode: "insensitive" } },
      select: { email: true },
    });
    for (const r of rs) if (r.email) out.add(byEmail.get(r.email.toLowerCase())!);
  }
  if (wonAlready) {
    const theirs = new Set(targets.map((t) => t.personId));
    for (const w of wonAlready) if (theirs.has(w.personId) && w.closedAt && w.closedAt >= c.createdAt) out.add(w.personId);
  } else {
    const won = await db.crmDealPerson.findMany({
      where: {
        organizationId,
        personId: { in: targets.map((t) => t.personId) },
        deal: { deletedAt: null, closedAt: { gte: c.createdAt }, stage: { kind: "WON" } },
      },
      select: { personId: true },
    });
    for (const w of won) out.add(w.personId);
  }
  out.delete(undefined as unknown as string);
  return out;
}

/** The daily job: write the converted status back, so queues and reports agree. */
export async function persistConversions(db: TxClient, organizationId: string): Promise<number> {
  const active = await db.crmCampaign.findMany({
    where: { organizationId, status: "ACTIVE" },
    select: { id: true, createdAt: true, eventId: true, channel: true },
    take: 50,
  });
  let n = 0;
  for (const c of active) {
    const targets = await db.crmCampaignTarget.findMany({
      where: { organizationId, campaignId: c.id, status: { notIn: ["CONVERTED", "SKIPPED"] } },
      select: { personId: true, person: { select: { primaryEmail: true, userId: true } } },
    });
    const conv = await convertedPeople(db, organizationId, c, targets);
    if (conv.size) {
      const r = await db.crmCampaignTarget.updateMany({
        where: { organizationId, campaignId: c.id, personId: { in: [...conv] } },
        data: { status: "CONVERTED" },
      });
      n += r.count;
    }
  }
  return n;
}

/** Contactable people in a member's share, for the send screen. */
export async function myShare(db: TxClient, organizationId: string, campaignId: string, userId: string, all = false) {
  const rows = await db.crmCampaignTarget.findMany({
    where: { organizationId, campaignId, ...(all ? {} : { assigneeId: userId }) },
    orderBy: [{ status: "asc" }, { person: { name: "asc" } }],
    take: 1000,
    select: {
      id: true,
      status: true,
      assigneeId: true,
      contactedAt: true,
      repliedAt: true,
      person: {
        select: {
          id: true,
          name: true,
          primaryEmail: true,
          phone: true,
          title: true,
          doNotContact: true,
          unsubscribedAt: true,
          consent: true,
          deletedAt: true,
          company: { select: { name: true } },
        },
      },
    },
  });
  return rows.map((r) => ({ ...r, blocked: contactable(r.person).reason }));
}

export type ShareRow = Awaited<ReturnType<typeof myShare>>[number];

/** Enqueues the bulk send of a bulk campaign (bulk.ts made its messages). */
export async function startBulk(db: TxClient, organizationId: string, campaignId: string): Promise<void> {
  await enqueueJob(db, { orgId: organizationId, kind: "crm-bulk", key: campaignId, payload: { campaignId } });
}


