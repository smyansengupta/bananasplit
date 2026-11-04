import type { Prisma } from "@/generated/prisma/client";
import { handoverBrief } from "@/lib/crm/outreach/brief";
import { crmSettingsHref } from "@/lib/crm/settings-sections";
import type { TxClient } from "@/server/db/context";
import { notifyUsers } from "@/server/notifications";

import { CrmError, requireManager, requireMember, type CrmAccess, type CrmActor } from "../access";
import { writeHistory } from "../history";
import type { RoleOwner } from "../owners";

/**
 * Handover when people change roles (docs/features/crm.md, "What makes
 * ours better" 5). Organizations rotate leaders and volunteers often, so:
 *
 * - When a member leaves (memberLeft, from untieDepartingMember) their
 *   sequences pause, they come off booking pages, and the CRM's managers
 *   are told how many relationships need a new owner.
 * - When an org-chart position changes holder (chartHoldersChanging, from
 *   the chart's publish), the relationships owned by that position follow
 *   it on their own; the new holder is told and gets the briefs.
 * - A manager hands someone's relationships to another member (or to a
 *   position) in one step: people, companies, items, pipelines, their open
 *   campaign shares, their sequences and booking pages.
 * - A brief per contact: history, open items, what we still owe them and
 *   the money involved, so whoever takes over isn't writing cold.
 * - Anyone left with no owner (nobody, a member who left, a position with
 *   no holder) is flagged.
 */

async function crmIsOn(db: TxClient, organizationId: string): Promise<boolean> {
  const s = await db.crmSettings.findUnique({ where: { organizationId }, select: { setupDoneAt: true } });
  return Boolean(s?.setupDoneAt);
}

async function managers(db: TxClient, organizationId: string, except: string): Promise<string[]> {
  const s = await db.crmSettings.findUnique({ where: { organizationId }, select: { managerIds: true } });
  const admins = await db.membership.findMany({
    where: { organizationId, role: { in: ["OWNER", "ADMIN"] } },
    select: { userId: true },
  });
  return [...new Set([...admins.map((a) => a.userId), ...(s?.managerIds ?? [])])].filter((id) => id !== except);
}

export async function ownedCounts(db: TxClient, organizationId: string, userId: string) {
  return {
    people: await db.crmPerson.count({ where: { organizationId, ownerId: userId, deletedAt: null } }),
    companies: await db.crmCompany.count({ where: { organizationId, ownerId: userId, deletedAt: null } }),
    deals: await db.crmDeal.count({ where: { organizationId, ownerId: userId, deletedAt: null, closedAt: null } }),
  };
}

/** A member is leaving: called in the removal's own transaction, before the membership goes. */
export async function memberLeft(db: TxClient, organizationId: string, userId: string): Promise<void> {
  if (!(await crmIsOn(db, organizationId))) return;
  // Their sequences wait for a new sender; they stop being booked.
  await db.crmEnrollment.updateMany({
    where: { organizationId, senderId: userId, status: "ACTIVE" },
    data: { status: "PAUSED", stopReason: "the sender left", nextRunAt: null },
  });
  const pages = await db.crmBookingPage.findMany({ where: { organizationId, hostIds: { has: userId } }, select: { id: true, hostIds: true } });
  for (const p of pages) {
    const hosts = p.hostIds.filter((h) => h !== userId);
    await db.crmBookingPage.update({ where: { id: p.id }, data: { hostIds: hosts, ...(hosts.length ? {} : { active: false }) } });
  }
  const n = await ownedCounts(db, organizationId, userId);
  const total = n.people + n.companies + n.deals;
  if (total === 0) return;
  const who = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  await notifyUsers(db, organizationId, await managers(db, organizationId, userId), {
    type: "CRM_HANDOVER",
    title: `${who?.name ?? "A member"} left: ${total} relationship${total === 1 ? "" : "s"} need a new owner`,
    body: [
      n.people ? `${n.people} ${n.people === 1 ? "person" : "people"}` : null,
      n.companies ? `${n.companies} ${n.companies === 1 ? "company" : "companies"}` : null,
      n.deals ? `${n.deals} open deal${n.deals === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(", "),
    linkUrl: org ? crmSettingsHref(org.slug, "team") : null,
    dedupeKey: `crm-left:${userId}:${new Date().toISOString().slice(0, 10)}`,
  });
}

/**
 * The chart is about to be published with these positions: tell each
 * position's new holder what they now look after, and the managers about
 * a position left with nobody.
 */
export async function chartHoldersChanging(
  db: TxClient,
  organizationId: string,
  next: readonly { key: string; title: string; userId: string | null }[],
  actorId: string,
): Promise<void> {
  if (!(await crmIsOn(db, organizationId))) return;
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { slug: true, activeOrgChartVersionId: true },
  });
  const before = org?.activeOrgChartVersionId
    ? await db.orgChartPosition.findMany({
        where: { organizationId, versionId: org.activeOrgChartVersionId },
        select: { key: true, userId: true },
      })
    : [];
  const was = new Map(before.map((p) => [p.key, p.userId]));
  for (const p of next) {
    const old = was.get(p.key) ?? null;
    if (old === p.userId) continue;
    const people = await db.crmPerson.count({ where: { organizationId, ownerRoleKey: p.key, deletedAt: null } });
    const companies = await db.crmCompany.count({ where: { organizationId, ownerRoleKey: p.key, deletedAt: null } });
    const deals = await db.crmDeal.count({ where: { organizationId, ownerRoleKey: p.key, deletedAt: null, closedAt: null } });
    const total = people + companies + deals;
    if (total === 0) continue;
    const link = org ? crmSettingsHref(org.slug, "you", `?role=${encodeURIComponent(p.key)}`) : null;
    if (p.userId) {
      await notifyUsers(db, organizationId, [p.userId], {
        type: "CRM_HANDOVER",
        title: `You're now ${p.title}: ${total} relationship${total === 1 ? " is" : "s are"} yours`,
        body: "Read the handover brief for each before you reach out.",
        linkUrl: link,
        actorId,
        dedupeKey: `crm-role:${p.key}:${p.userId}`,
      });
    } else {
      await notifyUsers(db, organizationId, await managers(db, organizationId, actorId), {
        type: "CRM_HANDOVER",
        title: `Nobody holds ${p.title}: ${total} relationship${total === 1 ? " has" : "s have"} no owner`,
        linkUrl: link,
        actorId,
        dedupeKey: `crm-role-open:${p.key}:${new Date().toISOString().slice(0, 10)}`,
      });
    }
  }
}

export interface HandOverInput {
  fromUserId: string;
  /** A member, or an org-chart position ("r:{key}" style is decoded by the caller). */
  toUserId?: string | null;
  toRoleKey?: string | null;
  /** Only these people (default: everything they own). */
  personIds?: string[];
}

/** Hands one member's relationships to another member or a position, in one step. */
export async function handOver(
  actor: CrmActor,
  access: CrmAccess,
  input: HandOverInput,
  roles: ReadonlyMap<string, RoleOwner>,
): Promise<{ people: number; companies: number; deals: number }> {
  requireManager(access);
  const { db, organizationId, userId } = actor;
  if (!input.toUserId && !input.toRoleKey) throw new CrmError("Pick who takes them over.");
  if (input.toUserId) await requireMember(db, organizationId, input.toUserId);
  if (input.toRoleKey && !roles.has(input.toRoleKey)) throw new CrmError("That position isn't on the published chart.");
  if (input.toUserId === input.fromUserId) throw new CrmError("Pick someone else.");
  const owner = input.toUserId ? { ownerId: input.toUserId, ownerRoleKey: null } : { ownerId: null, ownerRoleKey: input.toRoleKey! };
  const scope = input.personIds?.length ? { id: { in: input.personIds } } : {};
  const people = await db.crmPerson.findMany({
    where: { organizationId, ownerId: input.fromUserId, deletedAt: null, ...scope },
    select: { id: true },
    take: 5000,
  });
  const companies = input.personIds?.length
    ? []
    : await db.crmCompany.findMany({ where: { organizationId, ownerId: input.fromUserId, deletedAt: null }, select: { id: true }, take: 5000 });
  const deals = input.personIds?.length
    ? []
    : await db.crmDeal.findMany({ where: { organizationId, ownerId: input.fromUserId, deletedAt: null }, select: { id: true }, take: 5000 });
  const batch = `handover-${Date.now().toString(36)}`;
  const change = (kind: "person" | "company" | "deal", id: string) =>
    writeHistory(db, {
      organizationId,
      targetKind: kind,
      targetId: id,
      changes: [
        { field: "ownerId", oldValue: input.fromUserId, newValue: owner.ownerId },
        ...(owner.ownerRoleKey ? [{ field: "ownerRoleKey", oldValue: null, newValue: owner.ownerRoleKey }] : []),
      ],
      userId,
      batchId: batch,
    });
  for (const p of people) {
    await db.crmPerson.update({ where: { id: p.id }, data: { ...owner, updatedById: userId } });
    await change("person", p.id);
  }
  for (const c of companies) {
    await db.crmCompany.update({ where: { id: c.id }, data: { ...owner, updatedById: userId } });
    await change("company", c.id);
  }
  for (const d of deals) {
    await db.crmDeal.update({ where: { id: d.id }, data: { ...owner, updatedById: userId } });
    await change("deal", d.id);
  }
  if (!input.personIds?.length) {
    await db.crmPipeline.updateMany({ where: { organizationId, ownerId: input.fromUserId }, data: owner });
  }
  const newMember = input.toUserId ?? roles.get(input.toRoleKey ?? "")?.userId ?? null;
  if (newMember) {
    await db.crmCampaignTarget.updateMany({
      where: {
        organizationId,
        assigneeId: input.fromUserId,
        status: "TODO",
        ...(input.personIds?.length ? { personId: { in: input.personIds } } : {}),
      },
      data: { assigneeId: newMember },
    });
    await db.crmEnrollment.updateMany({
      where: {
        organizationId,
        senderId: input.fromUserId,
        status: { in: ["ACTIVE", "PAUSED"] },
        ...(input.personIds?.length ? { personId: { in: input.personIds } } : {}),
      },
      data: { senderId: newMember },
    });
    const from = await db.user.findUnique({ where: { id: input.fromUserId }, select: { name: true } });
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
    const total = people.length + companies.length + deals.length;
    if (total && newMember !== userId) {
      await notifyUsers(db, organizationId, [newMember], {
        type: "CRM_HANDOVER",
        title: `${total} relationship${total === 1 ? "" : "s"} handed to you from ${from?.name ?? "a former member"}`,
        body: "Read the handover brief for each before you reach out.",
        linkUrl: org ? crmSettingsHref(org.slug, "you") : null,
        actorId: userId,
        dedupeKey: `crm-handover:${batch}:${newMember}`,
      });
    }
  }
  return { people: people.length, companies: companies.length, deals: deals.length };
}

/** People with no one responsible: no owner, a member who left, or a position nobody holds. */
export async function unowned(
  db: TxClient,
  organizationId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  take = 200,
): Promise<{ id: string; name: string; why: string; lastContactedAt: Date | null }[]> {
  const members = new Set(
    (await db.membership.findMany({ where: { organizationId }, select: { userId: true }, take: 5000 })).map((m) => m.userId),
  );
  const open = [...roles.values()].filter((r) => !r.userId).map((r) => r.key);
  const rows = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { not: "INACTIVE" },
      OR: [
        { ownerId: null, ownerRoleKey: null },
        { ownerId: { notIn: [...members] }, ownerRoleKey: null },
        ...(open.length ? [{ ownerRoleKey: { in: open } }] : []),
      ],
    },
    orderBy: [{ strength: "desc" }, { name: "asc" }],
    take,
    select: { id: true, name: true, ownerId: true, ownerRoleKey: true, lastContactedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lastContactedAt: r.lastContactedAt,
    why: r.ownerRoleKey
      ? `${roles.get(r.ownerRoleKey)?.title ?? "A position"} is open`
      : r.ownerId
        ? "Their owner left"
        : "No owner",
  }));
}

/** Members who left but still own relationships. */
export async function departedOwners(db: TxClient, organizationId: string) {
  const members = (await db.membership.findMany({ where: { organizationId }, select: { userId: true }, take: 5000 })).map((m) => m.userId);
  const rows = await db.crmPerson.groupBy({
    by: ["ownerId"],
    where: { organizationId, deletedAt: null, ownerId: { not: null, notIn: members } },
    _count: { _all: true },
  });
  const users = await db.user.findMany({ where: { id: { in: rows.map((r) => r.ownerId!) } }, select: { id: true, name: true } });
  return rows.map((r) => ({ userId: r.ownerId!, name: users.find((u) => u.id === r.ownerId)?.name ?? "A former member", people: r._count._all }));
}

/** The brief for each person a member (or position) now looks after. */
export async function briefs(
  db: TxClient,
  organizationId: string,
  where: Prisma.CrmPersonWhereInput,
  take = 50,
): Promise<{ id: string; name: string; lines: string[] }[]> {
  const people = await db.crmPerson.findMany({
    where: { organizationId, deletedAt: null, ...where },
    orderBy: [{ strength: "desc" }, { name: "asc" }],
    take,
    select: {
      id: true,
      name: true,
      title: true,
      lastContactedAt: true,
      keepInTouchDays: true,
      doNotContact: true,
      company: { select: { name: true } },
      deals: { select: { deal: { select: { id: true, title: true, amountCents: true, nextStep: true, closedAt: true, deletedAt: true, stage: { select: { name: true, kind: true } } } } } },
    },
  });
  const out: { id: string; name: string; lines: string[] }[] = [];
  for (const p of people) {
    const history = await db.crmFieldHistory.findFirst({
      where: { organizationId, targetKind: "person", targetId: p.id, field: "ownerId" },
      orderBy: { changedAt: "desc" },
      select: { oldValue: true },
    });
    const previousId = typeof history?.oldValue === "string" ? history.oldValue : null;
    const previous = previousId ? await db.user.findUnique({ where: { id: previousId }, select: { name: true } }) : null;
    const links = await db.crmActivityTarget.findMany({
      where: { organizationId, targetKind: "person", targetId: p.id },
      orderBy: { occurredAt: "desc" },
      take: 200,
      select: { activityId: true, occurredAt: true },
    });
    const recent = links.length
      ? await db.crmActivity.findMany({
          where: { organizationId, id: { in: links.slice(0, 20).map((l) => l.activityId) }, deletedAt: null, kind: { notIn: ["FIELD_CHANGE", "SYSTEM"] } },
          orderBy: { occurredAt: "desc" },
          take: 5,
          select: { kind: true, subject: true, occurredAt: true },
        })
      : [];
    const deals = p.deals.map((d) => d.deal).filter((d) => !d.deletedAt);
    const open = deals.filter((d) => !d.closedAt);
    const promises = open.length
      ? await db.crmDeliverable.findMany({
          where: { organizationId, dealId: { in: open.map((d) => d.id) }, doneAt: null },
          orderBy: { dueOn: { sort: "asc", nulls: "last" } },
          select: { title: true, dueOn: true },
          take: 10,
        })
      : [];
    out.push({
      id: p.id,
      name: p.name,
      lines: handoverBrief({
        name: p.name,
        company: p.company?.name ?? null,
        title: p.title,
        previousOwner: previous?.name ?? null,
        lastContactedAt: p.lastContactedAt,
        firstContactAt: links.at(-1)?.occurredAt ?? null,
        touches: links.length,
        recent: recent.map((r) => ({ kind: r.kind, subject: r.subject, at: r.occurredAt })),
        open: open.map((d) => ({ title: d.title, stage: d.stage.name, nextStep: d.nextStep, amountCents: d.amountCents })),
        promises,
        receivedCents: deals.filter((d) => d.stage.kind === "WON").reduce((n, d) => n + (d.amountCents ?? 0), 0),
        pledgedCents: open.reduce((n, d) => n + (d.amountCents ?? 0), 0),
        cadenceDays: p.keepInTouchDays,
        doNotContact: p.doNotContact,
      }),
    });
  }
  return out;
}
