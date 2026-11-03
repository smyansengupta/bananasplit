import { recapLines } from "@/lib/crm/outreach/brief";
import { withSystemOrgTx, type OrgContext, type TxClient } from "@/server/db/context";
import { createTask, loadTaskEnv } from "@/server/tasks/service";

import { CrmError, type CrmActor } from "../access";
import { logActivity } from "../activity";
import { tokenTarget } from "./public";
import { guestUrl, sha256, guestToken } from "./tokens";

/**
 * What we owe them (docs/features/crm.md, "What makes ours better" 4):
 * deliverables (promises) on a deal or partnership (logo on the shirts, a talk
 * slot, two posts), each optionally tracked by a Task, and a private guest
 * link (/g/{token}) where the partner or client sees only their agreement,
 * what we promised and how it's going, and a recap built from real event
 * and attendance numbers (events linked to the item or its company).
 */

export interface DeliverableInput {
  title: string;
  dueOn?: string | null;
  /** Make a Task for it, owned by this member. */
  taskOwnerId?: string | null;
}

async function dealOf(db: TxClient, organizationId: string, dealId: string) {
  const d = await db.crmDeal.findFirst({
    where: { id: dealId, organizationId, deletedAt: null },
    select: { id: true, title: true, ownerId: true, companyId: true },
  });
  if (!d) throw new CrmError("That item isn't here any more.");
  return d;
}

export async function addDeliverable(ctx: OrgContext, dealId: string, input: DeliverableInput): Promise<{ id: string }> {
  const { db, organizationId, userId } = ctx;
  const deal = await dealOf(db, organizationId, dealId);
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new CrmError("Say what we owe them.", ["title"]);
  const dueOn = input.dueOn ? new Date(`${input.dueOn}T12:00:00Z`) : null;
  if (dueOn && Number.isNaN(dueOn.getTime())) throw new CrmError("Pick a real date.", ["dueOn"]);
  const last = await db.crmDeliverable.aggregate({ where: { organizationId, dealId }, _max: { sortOrder: true } });
  let taskId: string | null = null;
  if (input.taskOwnerId !== undefined && input.taskOwnerId !== null) {
    const env = await loadTaskEnv(ctx);
    const res = await createTask(env, {
      title: `${title} (${deal.title})`.slice(0, 200),
      description: `What we owe ${deal.title}. Tracked in the CRM.`,
      ownerId: input.taskOwnerId || userId,
      dueDate: input.dueOn ?? null,
    });
    if (res.error) throw new CrmError(res.error);
    taskId = res.taskId ?? null;
    if (taskId) {
      await db.itemLink.createMany({
        data: [{ organizationId, fromKind: "task", fromId: taskId, toKind: "crm-deal", toId: deal.id, createdById: userId }],
        skipDuplicates: true,
      });
    }
  }
  return db.crmDeliverable.create({
    data: { organizationId, dealId: deal.id, title, dueOn, taskId, sortOrder: (last._max.sortOrder ?? 0) + 1 },
    select: { id: true },
  });
}

export async function setDeliverableDone(actor: CrmActor, id: string, done: boolean, proof?: string | null): Promise<void> {
  const { db, organizationId, userId } = actor;
  const d = await db.crmDeliverable.findFirst({ where: { id, organizationId }, select: { id: true, dealId: true, title: true, doneAt: true } });
  if (!d) throw new CrmError("That isn't here any more.");
  await db.crmDeliverable.update({
    where: { id: d.id },
    data: { doneAt: done ? (d.doneAt ?? new Date()) : null, ...(proof !== undefined ? { proof: proof?.trim().slice(0, 500) || null } : {}) },
  });
  if (done && !d.doneAt) {
    await logActivity(db, {
      organizationId,
      kind: "NOTE",
      subject: `Delivered: ${d.title}`,
      targets: [{ kind: "deal", id: d.dealId }],
      actorId: userId,
      createdById: userId,
    });
  }
}

export async function removeDeliverable(actor: CrmActor, id: string): Promise<void> {
  const res = await actor.db.crmDeliverable.deleteMany({ where: { id, organizationId: actor.organizationId } });
  if (res.count === 0) throw new CrmError("That isn't here any more.");
}

export async function deliverablesOf(db: TxClient, organizationId: string, dealId: string) {
  const rows = await db.crmDeliverable.findMany({
    where: { organizationId, dealId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, dueOn: true, doneAt: true, taskId: true, proof: true },
  });
  const taskIds = rows.map((r) => r.taskId).filter((t): t is string => Boolean(t));
  const tasks = taskIds.length
    ? await db.task.findMany({ where: { organizationId, id: { in: taskIds } }, select: { id: true, status: true } })
    : [];
  return rows.map((r) => ({
    ...r,
    // A finished task counts as delivered.
    done: Boolean(r.doneAt) || tasks.some((t) => t.id === r.taskId && t.status === "COMPLETED"),
  }));
}

// ---- Guest links ----------------------------------------------------------------------

export async function createGuestLink(actor: CrmActor, dealId: string, expiresInDays: number | null): Promise<{ id: string; url: string }> {
  const { db, organizationId, userId } = actor;
  const deal = await dealOf(db, organizationId, dealId);
  const expiresAt = expiresInDays ? new Date(Date.now() + Math.min(expiresInDays, 730) * 86_400_000) : null;
  const row = await db.crmGuestLink.create({
    data: { organizationId, dealId: deal.id, tokenHash: `pending-${crypto.randomUUID()}`, createdById: userId, expiresAt },
    select: { id: true },
  });
  await db.crmGuestLink.update({ where: { id: row.id }, data: { tokenHash: sha256(guestToken(row.id)) } });
  return { id: row.id, url: guestUrl(row.id) };
}

export async function revokeGuestLink(actor: CrmActor, id: string): Promise<void> {
  const res = await actor.db.crmGuestLink.updateMany({
    where: { id, organizationId: actor.organizationId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) throw new CrmError("That link is already off.");
}

export async function guestLinksOf(db: TxClient, organizationId: string, dealId: string) {
  const rows = await db.crmGuestLink.findMany({
    where: { organizationId, dealId },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, expiresAt: true, revokedAt: true, lastViewedAt: true },
  });
  return rows.map((r) => ({ ...r, url: r.revokedAt ? null : guestUrl(r.id) }));
}

export interface GuestPage {
  orgName: string;
  title: string;
  noun: string;
  stage: string;
  stageKind: "OPEN" | "WON" | "LOST";
  amountCents: number | null;
  currency: string;
  expectedOn: Date | null;
  companyName: string | null;
  contact: string | null;
  deliverables: { title: string; dueOn: Date | null; done: boolean; proof: string | null }[];
  events: { title: string; startsAt: Date; checkIns: number; signUps: number }[];
  recap: string[];
}

/** What a partner or client sees, read on the service path in the link's organization. */
export async function loadGuestPage(token: string, now: Date = new Date()): Promise<GuestPage | null> {
  const target = await tokenTarget("guest", token);
  if (!target) return null;
  return withSystemOrgTx(target.organizationId, async ({ db }) => {
    const orgId = target.organizationId;
    const link = await db.crmGuestLink.findFirst({ where: { id: target.id, organizationId: orgId }, select: { dealId: true } });
    if (!link) return null;
    await db.crmGuestLink.update({ where: { id: target.id }, data: { lastViewedAt: now } });
    const deal = await db.crmDeal.findFirst({
      where: { id: link.dealId, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        title: true,
        amountCents: true,
        currency: true,
        expectedOn: true,
        companyId: true,
        ownerId: true,
        pipeline: { select: { itemNoun: true, hasAmount: true } },
        stage: { select: { name: true, kind: true } },
        company: { select: { name: true } },
      },
    });
    if (!deal) return null;
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    const owner = deal.ownerId ? await db.user.findUnique({ where: { id: deal.ownerId }, select: { name: true } }) : null;
    const deliverables = await deliverablesOf(db, orgId, deal.id);
    // Events linked to the item or its company, with their real numbers.
    const links = await db.itemLink.findMany({
      where: {
        organizationId: orgId,
        OR: [
          { toKind: "crm-deal", toId: deal.id, fromKind: "event" },
          ...(deal.companyId ? [{ toKind: "crm-company", toId: deal.companyId, fromKind: "event" }] : []),
          { fromKind: "crm-deal", fromId: deal.id, toKind: "event" },
          ...(deal.companyId ? [{ fromKind: "crm-company", fromId: deal.companyId, toKind: "event" }] : []),
        ],
      },
      select: { fromKind: true, fromId: true, toId: true },
      take: 50,
    });
    const eventIds = [...new Set(links.map((l) => (l.fromKind === "event" ? l.fromId : l.toId)))];
    const events = eventIds.length
      ? await db.event.findMany({
          where: { organizationId: orgId, id: { in: eventIds }, deletedAt: null, startsAt: { lte: now } },
          orderBy: { startsAt: "asc" },
          select: { id: true, title: true, startsAt: true },
        })
      : [];
    const numbers = [];
    for (const e of events) {
      numbers.push({
        title: e.title,
        startsAt: e.startsAt,
        checkIns: await db.attendance.count({ where: { organizationId: orgId, eventId: e.id, suppressedAt: null } }),
        signUps: await db.eventRegistration.count({ where: { organizationId: orgId, eventId: e.id, status: { not: "CANCELLED" } } }),
      });
    }
    const shown = deliverables.map((d) => ({ title: d.title, dueOn: d.dueOn, done: d.done, proof: d.proof }));
    return {
      orgName: org?.name ?? "",
      title: deal.title,
      noun: deal.pipeline.itemNoun,
      stage: deal.stage.name,
      stageKind: deal.stage.kind,
      amountCents: deal.pipeline.hasAmount ? deal.amountCents : null,
      currency: deal.currency,
      expectedOn: deal.expectedOn,
      companyName: deal.company?.name ?? null,
      contact: owner?.name ?? null,
      deliverables: shown,
      events: numbers,
      recap: recapLines({
        orgName: org?.name ?? "",
        companyName: deal.company?.name ?? null,
        events: numbers,
        deliverables: shown.map((d) => ({ title: d.title, doneAt: d.done ? now : null, dueOn: d.dueOn })),
      }),
    };
  });
}
