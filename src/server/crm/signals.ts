import type { Prisma } from "@/generated/prisma/client";
import { formatMoney } from "@/lib/crm/fields";
import type { TxClient } from "@/server/db/context";

import { effectiveOwnerId, type RoleOwner } from "./owners";

/**
 * Signals from inside the organization (docs/features/crm.md, module 9 and
 * "What makes ours better" 11), found by the daily job and shown in each
 * member's Inbox under To review: stuck items, items with no next step,
 * someone who went quiet, a renewal coming up, a regular who stopped
 * coming, a pledge overdue, a past member back at events, an unusual drop
 * in outreach.
 *
 * Each is a CrmSuggestion (source SIGNAL, assigned to whoever owns the
 * record now, the role's holder first) with a stable key, so a signal is
 * raised once: done or dismissed, it isn't raised again for the same
 * thing; one whose reason went away (the item moved on) expires.
 */

export const SIGNAL_KINDS = ["stuck", "nostep", "quiet", "renewal", "stopped", "pledge", "back", "drop"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  stuck: "Stuck",
  nostep: "No next step",
  quiet: "Went quiet",
  renewal: "Renewal coming up",
  stopped: "Stopped coming",
  pledge: "Pledge overdue",
  back: "Back at events",
  drop: "Outreach dropped",
};

interface Found {
  key: string;
  kind: SignalKind;
  title: string;
  summary: string;
  targetKind: "person" | "company" | "deal" | null;
  targetId: string | null;
  assigneeId: string;
}

const DAY = 86_400_000;
const LIMIT = 500;

function daysAgo(now: Date, n: number): Date {
  return new Date(now.getTime() - n * DAY);
}

const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Everything that deserves a look today. */
export async function findSignals(
  db: TxClient,
  organizationId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  now: Date = new Date(),
): Promise<Found[]> {
  const out: Found[] = [];
  const owner = (r: { ownerId: string | null; ownerRoleKey: string | null }) => effectiveOwnerId(r, roles);

  // Stuck items, and items with no next step.
  const open = await db.crmDeal.findMany({
    where: { organizationId, deletedAt: null, closedAt: null },
    select: {
      id: true,
      title: true,
      ownerId: true,
      ownerRoleKey: true,
      nextStep: true,
      createdAt: true,
      stageEnteredAt: true,
      expectedOn: true,
      amountCents: true,
      currency: true,
      stage: { select: { name: true, key: true, stuckAfterDays: true } },
      pipeline: { select: { itemNoun: true, hasAmount: true } },
    },
    orderBy: { stageEnteredAt: "asc" },
    take: 5000,
  });
  for (const d of open) {
    const who = owner(d);
    if (!who) continue;
    const inStage = Math.floor((now.getTime() - d.stageEnteredAt.getTime()) / DAY);
    if (d.stage.stuckAfterDays && inStage >= d.stage.stuckAfterDays) {
      out.push({
        key: `stuck:${d.id}:${d.stageEnteredAt.getTime().toString(36)}`,
        kind: "stuck",
        title: `${d.title} is stuck in ${d.stage.name}`,
        summary: `${inStage} days in ${d.stage.name}; the limit is ${d.stage.stuckAfterDays}.`,
        targetKind: "deal",
        targetId: d.id,
        assigneeId: who,
      });
    } else if (!d.nextStep?.trim() && now.getTime() - d.createdAt.getTime() > 3 * DAY) {
      out.push({
        key: `nostep:${d.id}`,
        kind: "nostep",
        title: `${d.title} has no next step`,
        summary: `Say what happens next with this ${d.pipeline.itemNoun}.`,
        targetKind: "deal",
        targetId: d.id,
        assigneeId: who,
      });
    }
    const promised = d.stage.key && ["PLEDGED", "COMMITTED", "INVOICED"].includes(d.stage.key);
    if (promised && d.expectedOn && d.expectedOn < daysAgo(now, 7)) {
      out.push({
        key: `pledge:${d.id}:${d.expectedOn.toISOString().slice(0, 10)}`,
        kind: "pledge",
        title: `${d.title} is overdue`,
        summary: `${d.amountCents ? `${formatMoney(d.amountCents, d.currency)} ` : ""}${d.stage.name.toLowerCase()}, expected by ${short.format(d.expectedOn)}.`,
        targetKind: "deal",
        targetId: d.id,
        assigneeId: who,
      });
    }
  }

  // Someone who went quiet: a real relationship, no contact for 45 to 120 days.
  const quiet = await db.crmPerson.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: "ACTIVE",
      doNotContact: false,
      strength: { gte: 30 },
      lastContactedAt: { lt: daysAgo(now, 45), gte: daysAgo(now, 120) },
    },
    select: { id: true, name: true, ownerId: true, ownerRoleKey: true, lastContactedAt: true },
    orderBy: { strength: "desc" },
    take: LIMIT,
  });
  for (const p of quiet) {
    const who = owner(p);
    if (!who || !p.lastContactedAt) continue;
    const days = Math.floor((now.getTime() - p.lastContactedAt.getTime()) / DAY);
    out.push({
      key: `quiet:${p.id}:${p.lastContactedAt.getTime().toString(36)}`,
      kind: "quiet",
      title: `${p.name} went quiet`,
      summary: `Nobody's been in touch for ${days} days.`,
      targetKind: "person",
      targetId: p.id,
      assigneeId: who,
    });
  }

  // A renewal coming up: won a year ago, give or take two weeks.
  const renewals = await db.crmDeal.findMany({
    where: {
      organizationId,
      deletedAt: null,
      stage: { kind: "WON" },
      closedAt: { gte: daysAgo(now, 379), lte: daysAgo(now, 351) },
    },
    select: { id: true, title: true, ownerId: true, ownerRoleKey: true, closedAt: true, company: { select: { name: true } } },
    take: LIMIT,
  });
  for (const d of renewals) {
    const who = owner(d);
    if (!who || !d.closedAt) continue;
    out.push({
      key: `renewal:${d.id}:${d.closedAt.getUTCFullYear()}`,
      kind: "renewal",
      title: `Renewal coming up: ${d.company?.name ?? d.title}`,
      summary: `${d.title} closed ${short.format(d.closedAt)} last year. Time to ask again.`,
      targetKind: "deal",
      targetId: d.id,
      assigneeId: who,
    });
  }

  // A regular who stopped coming (the attendance rollups mark them lapsed).
  const lapsed = await db.$queryRaw<{ id: string; name: string; ownerId: string | null; ownerRoleKey: string | null; lapsedSince: Date; sessions: number }[]>`
    SELECT p.id, p.name, p."ownerId", p."ownerRoleKey", c."lapsedSince", c."sessionsAttended" AS sessions
    FROM "CrmPerson" p JOIN "Contact" c ON c.id = p."contactId" AND c."organizationId" = p."organizationId"
    WHERE p."organizationId" = ${organizationId} AND p."deletedAt" IS NULL
      AND c."lapsedSince" >= ${daysAgo(now, 30)} AND c."sessionsAttended" >= 3
    LIMIT ${LIMIT}`;
  for (const p of lapsed) {
    const who = owner(p);
    if (!who) continue;
    out.push({
      key: `stopped:${p.id}:${p.lapsedSince.getTime().toString(36)}`,
      kind: "stopped",
      title: `${p.name} stopped coming`,
      summary: `Came ${p.sessions} times, then missed the last few sessions.`,
      targetKind: "person",
      targetId: p.id,
      assigneeId: who,
    });
  }

  // A past member back at events: a check-in in the last two weeks from someone inactive or alumni.
  const back = await db.$queryRaw<{ id: string; name: string; ownerId: string | null; ownerRoleKey: string | null; activityId: string; at: Date }[]>`
    SELECT DISTINCT ON (p.id) p.id, p.name, p."ownerId", p."ownerRoleKey", a.id AS "activityId", a."occurredAt" AS at
    FROM "CrmActivityTarget" t
    JOIN "CrmActivity" a ON a.id = t."activityId"
    JOIN "CrmPerson" p ON p.id = t."targetId" AND p."organizationId" = t."organizationId"
    WHERE t."organizationId" = ${organizationId} AND t."targetKind" = 'person'
      AND a.kind = 'CHECK_IN' AND a."deletedAt" IS NULL AND a."occurredAt" >= ${daysAgo(now, 14)}
      AND p."deletedAt" IS NULL AND p.status IN ('ALUMNI', 'INACTIVE')
    ORDER BY p.id, a."occurredAt" DESC
    LIMIT ${LIMIT}`;
  for (const p of back) {
    const who = owner(p);
    if (!who) continue;
    out.push({
      key: `back:${p.id}:${p.activityId}`,
      kind: "back",
      title: `${p.name} is back at events`,
      summary: `Checked in ${short.format(p.at)}. Worth a hello.`,
      targetKind: "person",
      targetId: p.id,
      assigneeId: who,
    });
  }

  // An unusual drop in outreach: a member's last two weeks against their usual.
  const outreach = await db.$queryRaw<{ actorId: string; recent: bigint; before: bigint }[]>`
    SELECT a."actorId",
      COUNT(*) FILTER (WHERE a."occurredAt" >= ${daysAgo(now, 14)}) AS recent,
      COUNT(*) FILTER (WHERE a."occurredAt" < ${daysAgo(now, 14)}) AS before
    FROM "CrmActivity" a
    WHERE a."organizationId" = ${organizationId} AND a."deletedAt" IS NULL AND a."actorId" IS NOT NULL
      AND a."occurredAt" >= ${daysAgo(now, 70)}
      AND ((a.kind IN ('EMAIL', 'CALL', 'TEXT') AND a.direction = 'OUTBOUND') OR a.kind = 'MEETING')
    GROUP BY a."actorId"`;
  const week = Math.floor(now.getTime() / (7 * DAY));
  for (const r of outreach) {
    const usual = Number(r.before) / 4; // per two weeks, over the eight weeks before
    const recent = Number(r.recent);
    if (usual >= 6 && recent < usual * 0.4) {
      out.push({
        key: `drop:${r.actorId}:${Math.floor(week / 2)}`,
        kind: "drop",
        title: "Your outreach dropped",
        summary: `${recent} in the last two weeks, against about ${Math.round(usual)} usually.`,
        targetKind: null,
        targetId: null,
        assigneeId: r.actorId,
      });
    }
  }
  return out;
}

/**
 * Raises today's signals once each, and expires the pending ones whose
 * reason went away. Returns how many were raised.
 */
export async function raiseSignals(
  db: TxClient,
  organizationId: string,
  roles: ReadonlyMap<string, RoleOwner>,
  now: Date = new Date(),
): Promise<number> {
  const found = await findSignals(db, organizationId, roles, now);
  const members = new Set(
    (await db.membership.findMany({ where: { organizationId }, select: { userId: true } })).map((m) => m.userId),
  );
  const existing = await db.crmSuggestion.findMany({
    where: { organizationId, source: "SIGNAL", createdAt: { gte: daysAgo(now, 400) } },
    select: { id: true, status: true, payload: true },
    take: 20_000,
  });
  const keyOf = (p: unknown) => (p && typeof p === "object" ? ((p as { key?: string }).key ?? null) : null);
  const known = new Set(existing.map((e) => keyOf(e.payload)).filter((k): k is string => Boolean(k)));
  const seen = new Set(found.map((f) => f.key));
  const stale = existing.filter((e) => e.status === "PENDING" && !seen.has(keyOf(e.payload) ?? ""));
  if (stale.length) {
    await db.crmSuggestion.updateMany({
      where: { organizationId, id: { in: stale.map((s) => s.id) } },
      data: { status: "EXPIRED" },
    });
  }
  const fresh = found.filter((f) => !known.has(f.key) && members.has(f.assigneeId));
  if (fresh.length) {
    await db.crmSuggestion.createMany({
      data: fresh.map((f) => ({
        organizationId,
        kind: "CREATE_TASK" as const,
        source: "SIGNAL" as const,
        title: f.title.slice(0, 300),
        summary: f.summary.slice(0, 500),
        payload: { key: f.key, signal: f.kind } as Prisma.InputJsonObject,
        targetKind: f.targetKind,
        targetId: f.targetId,
        citation: { kind: "signal", id: f.kind, label: SIGNAL_LABELS[f.kind] } as Prisma.InputJsonObject,
        assigneeId: f.assigneeId,
        expiresAt: new Date(now.getTime() + 30 * DAY),
      })),
    });
  }
  return fresh.length;
}

export interface SignalRow {
  id: string;
  kind: SignalKind;
  label: string;
  title: string;
  summary: string | null;
  targetKind: "person" | "company" | "deal" | null;
  targetId: string | null;
  createdAt: Date;
}

/** A member's pending signals, newest first (the Inbox's To review). */
export async function signalsFor(db: TxClient, organizationId: string, userId: string, take = 30): Promise<SignalRow[]> {
  const rows = await db.crmSuggestion.findMany({
    where: {
      organizationId,
      source: "SIGNAL",
      status: "PENDING",
      assigneeId: userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, title: true, summary: true, payload: true, targetKind: true, targetId: true, createdAt: true },
  });
  return rows.map((r) => {
    const kind = ((r.payload as { signal?: string } | null)?.signal ?? "stuck") as SignalKind;
    return {
      id: r.id,
      kind,
      label: SIGNAL_LABELS[kind] ?? "Signal",
      title: r.title,
      summary: r.summary,
      targetKind: (r.targetKind as SignalRow["targetKind"]) ?? null,
      targetId: r.targetId,
      createdAt: r.createdAt,
    };
  });
}
