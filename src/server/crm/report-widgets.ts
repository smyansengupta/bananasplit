import { Prisma } from "@/generated/prisma/client";
import { crmRecordHref } from "@/lib/crm/href";
import { formatMoney } from "@/lib/crm/fields";
import type { CrmListPayload, CrmSourceInfo, CrmStatPayload, CrmWidgetType } from "@/lib/reports/crm-widgets";
import { CRM_WIDGETS, formatCrmValue } from "@/lib/reports/crm-widgets";
import type { WidgetPayload } from "@/lib/reports/compute";
import { dayBounds, localDateKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";

import { listGoals } from "./goals";
import { readyWidgetPayload } from "./report-ready-widgets";

/**
 * The CRM's outreach and pipeline widgets in Reports (docs/features/crm.md,
 * module 7), computed on the server as the viewer (RLS decides the rows:
 * private timeline rows and, with members-see-their-own, other people's
 * records stay out). They read the timeline (CrmActivity), email
 * (CrmEmailMessage, filled by outreach), campaigns, field history and
 * goals directly; with none of that yet, each says so instead of a zero
 * that looks like a result.
 */

const DAY = 86_400_000;
const COLD_DAYS = 60;

export interface WidgetRange {
  from: string | null;
  to: string | null;
}

interface Ctx {
  db: TxClient;
  organizationId: string;
  slug: string;
  tz: string;
  range: WidgetRange;
  crm: CrmSourceInfo;
  now: Date;
}

/** The range as instants (all time: the last two years for activity, to keep it bounded). */
function bounds(c: Pick<Ctx, "range" | "tz" | "now">): { start: Date; end: Date } {
  const end = c.range.to ? dayBounds(c.range.to, c.tz).end : c.now;
  const start = c.range.from ? dayBounds(c.range.from, c.tz).start : new Date(c.now.getTime() - 730 * DAY);
  return { start, end };
}

/** The span just before, as long. */
function before(b: { start: Date; end: Date }): { start: Date; end: Date } {
  const len = b.end.getTime() - b.start.getTime();
  return { start: new Date(b.start.getTime() - len), end: b.start };
}

function delta(value: number | null, previous: number | null): number | null {
  if (value === null || previous === null || previous === 0) return null;
  return ((value - previous) / previous) * 100;
}

const stat = (p: Partial<CrmStatPayload> & Pick<CrmStatPayload, "format" | "caption">): CrmStatPayload => ({
  value: null,
  previous: null,
  deltaPct: null,
  parts: [],
  rows: [],
  empty: null,
  ...p,
});

const OUTREACH = Prisma.sql`((a.kind IN ('EMAIL', 'CALL', 'TEXT') AND a.direction = 'OUTBOUND') OR a.kind = 'MEETING')`;

async function reachedIn(c: Ctx, b: { start: Date; end: Date }): Promise<number> {
  const rows = await c.db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT t."targetId") AS n
    FROM "CrmActivityTarget" t JOIN "CrmActivity" a ON a.id = t."activityId"
    WHERE t."organizationId" = ${c.organizationId} AND t."targetKind" = 'person'
      AND a."deletedAt" IS NULL AND ${OUTREACH}
      AND a."occurredAt" >= ${b.start} AND a."occurredAt" < ${b.end}`;
  return Number(rows[0]?.n ?? 0);
}

async function replies(c: Ctx, b: { start: Date; end: Date }) {
  const rows = await c.db.$queryRaw<{ emailed: bigint; replied: bigint; median_hours: number | null }[]>`
    WITH firsts AS (
      SELECT t."targetId" AS pid, MIN(a."occurredAt") AS first_out
      FROM "CrmActivityTarget" t JOIN "CrmActivity" a ON a.id = t."activityId"
      WHERE t."organizationId" = ${c.organizationId} AND t."targetKind" = 'person'
        AND a."deletedAt" IS NULL AND a.kind = 'EMAIL' AND a.direction = 'OUTBOUND'
        AND a."occurredAt" >= ${b.start} AND a."occurredAt" < ${b.end}
      GROUP BY t."targetId"
    ), answered AS (
      SELECT f.pid, MIN(a."occurredAt") AS first_in
      FROM firsts f
      JOIN "CrmActivityTarget" t ON t."organizationId" = ${c.organizationId} AND t."targetKind" = 'person' AND t."targetId" = f.pid
      JOIN "CrmActivity" a ON a.id = t."activityId"
      WHERE a."deletedAt" IS NULL AND a.kind = 'EMAIL' AND a.direction = 'INBOUND' AND a."occurredAt" > f.first_out
      GROUP BY f.pid
    )
    SELECT COUNT(*) AS emailed, COUNT(r.pid) AS replied,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (r.first_in - f.first_out)) / 3600.0)
        FILTER (WHERE r.pid IS NOT NULL) AS median_hours
    FROM firsts f LEFT JOIN answered r ON r.pid = f.pid`;
  const r = rows[0];
  return {
    emailed: Number(r?.emailed ?? 0),
    replied: Number(r?.replied ?? 0),
    medianHours: r?.median_hours === null || r?.median_hours === undefined ? null : Number(r.median_hours),
  };
}

async function memberNames(c: Ctx): Promise<Map<string, string>> {
  const m = await c.db.membership.findMany({
    where: { organizationId: c.organizationId },
    select: { userId: true, user: { select: { name: true } } },
    take: 2000,
  });
  return new Map(m.map((x) => [x.userId, x.user.name ?? "A member"]));
}

const ago = (d: Date, now: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY));

// ---- Pipelines -------------------------------------------------------------------------

async function stagesOf(c: Ctx) {
  return c.db.crmStage.findMany({
    where: { organizationId: c.organizationId, pipelineId: c.crm.pipelineId ?? "" },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, kind: true },
  });
}

/** Items made in the range (or the newest 2,000), with every stage they've been in. */
async function stageJourneys(c: Ctx) {
  const b = bounds(c);
  const deals = await c.db.crmDeal.findMany({
    where: {
      organizationId: c.organizationId,
      pipelineId: c.crm.pipelineId ?? "",
      deletedAt: null,
      ...(c.range.from || c.range.to ? { createdAt: { gte: b.start, lt: b.end } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { id: true, stageId: true, createdAt: true, closedAt: true },
  });
  const history = deals.length
    ? await c.db.crmFieldHistory.findMany({
        where: {
          organizationId: c.organizationId,
          targetKind: "deal",
          field: "stageId",
          targetId: { in: deals.map((d) => d.id) },
        },
        orderBy: { changedAt: "asc" },
        select: { targetId: true, oldValue: true, newValue: true, changedAt: true },
      })
    : [];
  const byDeal = new Map<string, typeof history>();
  for (const h of history) byDeal.set(h.targetId, [...(byDeal.get(h.targetId) ?? []), h]);
  return deals.map((d) => {
    const moves = byDeal.get(d.id) ?? [];
    const first = moves.length > 0 && typeof moves[0]!.oldValue === "string" ? (moves[0]!.oldValue as string) : d.stageId;
    const segments: { stageId: string; from: Date; to: Date | null }[] = [];
    let current = first;
    let since = d.createdAt;
    for (const m of moves) {
      segments.push({ stageId: current, from: since, to: m.changedAt });
      current = typeof m.newValue === "string" ? m.newValue : current;
      since = m.changedAt;
    }
    segments.push({ stageId: current, from: since, to: null });
    return { id: d.id, closed: d.closedAt !== null, segments };
  });
}

async function conversion(c: Ctx): Promise<CrmListPayload> {
  const stages = (await stagesOf(c)).filter((s) => s.kind !== "LOST");
  const journeys = await stageJourneys(c);
  const order = new Map(stages.map((s, i) => [s.id, i]));
  const reached = stages.map(() => 0);
  for (const j of journeys) {
    let max = -1;
    for (const s of j.segments) max = Math.max(max, order.get(s.stageId) ?? -1);
    for (let i = 0; i <= max; i++) reached[i]!++;
  }
  const top = reached[0] ?? 0;
  return {
    rows: stages.map((s, i) => {
      const prev = i === 0 ? null : reached[i - 1]!;
      return {
        key: s.id,
        label: s.name,
        value: reached[i]!,
        display: reached[i]!.toLocaleString("en-US"),
        detail: prev === null ? "Started here" : prev ? `${Math.round((reached[i]! / prev) * 100)}% of the stage before` : null,
      };
    }),
    max: top,
    caption: top ? `${top} item${top === 1 ? "" : "s"} in these dates` : null,
    empty: "No items in these dates yet.",
  };
}

async function timeInStage(c: Ctx): Promise<CrmListPayload> {
  const stages = (await stagesOf(c)).filter((s) => s.kind === "OPEN");
  const journeys = await stageJourneys(c);
  const totals = new Map<string, { days: number; n: number }>();
  for (const j of journeys) {
    for (const s of j.segments) {
      const end = s.to ?? (j.closed ? null : c.now);
      if (!end) continue;
      const t = totals.get(s.stageId) ?? { days: 0, n: 0 };
      t.days += (end.getTime() - s.from.getTime()) / DAY;
      t.n += 1;
      totals.set(s.stageId, t);
    }
  }
  const rows = stages
    .filter((s) => totals.get(s.id)?.n)
    .map((s) => {
      const t = totals.get(s.id)!;
      const avg = t.days / t.n;
      return {
        key: s.id,
        label: s.name,
        value: avg,
        display: formatCrmValue(avg, "days"),
        detail: `Over ${t.n} item${t.n === 1 ? "" : "s"}`,
      };
    });
  return { rows, caption: null, empty: "No items have moved through a stage yet." };
}

async function closedBySource(c: Ctx) {
  const b = bounds(c);
  const rows = await c.db.crmDeal.findMany({
    where: {
      organizationId: c.organizationId,
      pipelineId: c.crm.pipelineId ?? "",
      deletedAt: null,
      closedAt: { gte: b.start, lt: b.end },
    },
    select: {
      source: true,
      amountCents: true,
      stage: { select: { kind: true } },
      primaryPersonId: true,
    },
    take: 20_000,
  });
  const personIds = [...new Set(rows.map((r) => r.primaryPersonId).filter((x): x is string => Boolean(x)))];
  const people = personIds.length
    ? await c.db.crmPerson.findMany({ where: { organizationId: c.organizationId, id: { in: personIds } }, select: { id: true, source: true } })
    : [];
  const personSource = new Map(people.map((p) => [p.id, p.source]));
  const groups = new Map<string, { won: number; closed: number; cents: number }>();
  for (const r of rows) {
    const raw = r.source?.trim() || (r.primaryPersonId ? personSource.get(r.primaryPersonId)?.trim() : null) || "";
    const key = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Not recorded";
    const g = groups.get(key) ?? { won: 0, closed: 0, cents: 0 };
    g.closed++;
    if (r.stage.kind === "WON") {
      g.won++;
      g.cents += r.amountCents ?? 0;
    }
    groups.set(key, g);
  }
  return groups;
}

async function velocity(c: Ctx): Promise<CrmStatPayload> {
  const b = c.range.from ? bounds(c) : { start: new Date(c.now.getTime() - 365 * DAY), end: c.now };
  const pipelineId = c.crm.pipelineId ?? "";
  const closed = await c.db.crmDeal.findMany({
    where: { organizationId: c.organizationId, pipelineId, deletedAt: null, closedAt: { gte: b.start, lt: b.end } },
    select: { amountCents: true, createdAt: true, closedAt: true, stage: { select: { kind: true } } },
    take: 20_000,
  });
  const open = await c.db.crmDeal.count({ where: { organizationId: c.organizationId, pipelineId, deletedAt: null, closedAt: null } });
  const won = closed.filter((d) => d.stage.kind === "WON");
  const lost = closed.filter((d) => d.stage.kind === "LOST");
  const decided = won.length + lost.length;
  if (decided === 0 || won.length === 0) {
    return stat({
      format: c.crm.hasAmount ? "perDay" : "number",
      caption: "What the pipeline brings in a day, at its own pace.",
      empty: open ? `${open} open, but nothing won in these dates yet to measure the pace by.` : "Nothing open or won yet.",
      parts: [{ label: "Open items", value: open.toLocaleString("en-US") }],
    });
  }
  const rate = won.length / decided;
  const avgDays = Math.max(1, won.reduce((a, d) => a + (d.closedAt!.getTime() - d.createdAt.getTime()) / DAY, 0) / won.length);
  const avgCents = won.reduce((a, d) => a + (d.amountCents ?? 0), 0) / won.length;
  const parts = [
    { label: "Open items", value: open.toLocaleString("en-US") },
    { label: "Success rate", value: formatCrmValue(rate, "percent") },
    ...(c.crm.hasAmount ? [{ label: "Average won", value: formatMoney(Math.round(avgCents)) }] : []),
    { label: "Days to close", value: formatCrmValue(avgDays, "days") },
  ];
  if (c.crm.hasAmount) {
    return stat({
      value: Math.round((open * rate * avgCents) / avgDays),
      format: "perDay",
      caption: "What the pipeline brings in a day, at its own pace.",
      parts,
    });
  }
  return stat({
    value: Math.round(((open * rate) / avgDays) * 30 * 10) / 10,
    format: "number",
    caption: "Items won a month at this pace.",
    parts,
  });
}

// ---- One widget ---------------------------------------------------------------------------

export async function crmWidgetPayload(
  input: Omit<Ctx, "now"> & { now?: Date },
  type: CrmWidgetType,
): Promise<WidgetPayload | null> {
  const c: Ctx = { ...input, now: input.now ?? new Date() };
  const def = CRM_WIDGETS[type];
  if (def.pipeline && (c.crm.kind !== "pipeline" || !c.crm.pipelineId)) return null;
  const b = bounds(c);
  const compare = Boolean(c.range.from);
  switch (type) {
    case "crm-reached": {
      const value = await reachedIn(c, b);
      const previous = compare ? await reachedIn(c, before(b)) : null;
      return {
        type,
        data: stat({
          value,
          previous,
          deltaPct: delta(value, previous),
          format: "number",
          caption: "Different people emailed, called, texted or met.",
          empty: value === 0 && !previous ? "No outreach on the timeline in these dates yet." : null,
        }),
      };
    }
    case "crm-reply-rate":
    case "crm-first-reply": {
      const now = await replies(c, b);
      const then = compare ? await replies(c, before(b)) : null;
      if (type === "crm-reply-rate") {
        const value = now.emailed ? now.replied / now.emailed : null;
        const previous = then && then.emailed ? then.replied / then.emailed : null;
        return {
          type,
          data: stat({
            value,
            previous,
            deltaPct: delta(value, previous),
            format: "percent",
            caption: now.emailed ? `${now.replied} of ${now.emailed} people emailed wrote back.` : "Of the people emailed, how many wrote back.",
            empty: now.emailed ? null : "Nobody was emailed in these dates yet.",
          }),
        };
      }
      return {
        type,
        data: stat({
          value: now.medianHours,
          previous: then?.medianHours ?? null,
          deltaPct: delta(now.medianHours, then?.medianHours ?? null),
          format: "hours",
          caption: now.replied ? `The middle of ${now.replied} first replies.` : "How long people take to write back.",
          empty: now.replied ? null : "No replies in these dates yet.",
        }),
      };
    }
    case "crm-overdue": {
      const today = dayBounds(localDateKey(c.now, c.tz), c.tz).start;
      const where = {
        organizationId: c.organizationId,
        deletedAt: null,
        status: "ACTIVE" as const,
        doNotContact: false,
        nextFollowUpAt: { lt: today },
      };
      const [count, rows, names] = await Promise.all([
        c.db.crmPerson.count({ where }),
        c.db.crmPerson.findMany({
          where,
          orderBy: { nextFollowUpAt: "asc" },
          take: 6,
          select: { id: true, name: true, nextFollowUpAt: true, ownerId: true },
        }),
        memberNames(c),
      ]);
      return {
        type,
        data: stat({
          value: count,
          format: "number",
          caption: "People whose follow-up date has passed.",
          empty: count ? null : "Every follow-up is on time.",
          rows: rows.map((p) => ({
            key: p.id,
            label: p.name,
            detail: [`${ago(p.nextFollowUpAt!, c.now)} days late`, p.ownerId ? names.get(p.ownerId) : null].filter(Boolean).join(", "),
            href: crmRecordHref(c.slug, "person", p.id),
          })),
        }),
      };
    }
    case "crm-cold": {
      const where = {
        organizationId: c.organizationId,
        deletedAt: null,
        status: "ACTIVE" as const,
        doNotContact: false,
        strength: { gte: 30 },
        lastContactedAt: { lt: new Date(c.now.getTime() - COLD_DAYS * DAY) },
      };
      const [count, rows] = await Promise.all([
        c.db.crmPerson.count({ where }),
        c.db.crmPerson.findMany({ where, orderBy: { strength: "desc" }, take: 6, select: { id: true, name: true, lastContactedAt: true } }),
      ]);
      return {
        type,
        data: stat({
          value: count,
          format: "number",
          caption: `People you knew well, quiet for ${COLD_DAYS} days or more.`,
          empty: count ? null : "No strong relationship has gone quiet.",
          rows: rows.map((p) => ({
            key: p.id,
            label: p.name,
            detail: `Last in touch ${ago(p.lastContactedAt!, c.now)} days ago`,
            href: crmRecordHref(c.slug, "person", p.id),
          })),
        }),
      };
    }
    case "crm-velocity":
      return { type, data: await velocity(c) };
    case "crm-by-member": {
      const rows = await c.db.$queryRaw<{ actor: string; people: bigint; emails: bigint; calls: bigint; meetings: bigint }[]>`
        SELECT a."actorId" AS actor, COUNT(DISTINCT t."targetId") AS people,
          COUNT(DISTINCT a.id) FILTER (WHERE a.kind = 'EMAIL') AS emails,
          COUNT(DISTINCT a.id) FILTER (WHERE a.kind = 'CALL') AS calls,
          COUNT(DISTINCT a.id) FILTER (WHERE a.kind = 'MEETING') AS meetings
        FROM "CrmActivity" a JOIN "CrmActivityTarget" t ON t."activityId" = a.id AND t."targetKind" = 'person'
        WHERE a."organizationId" = ${c.organizationId} AND a."deletedAt" IS NULL AND a."actorId" IS NOT NULL AND ${OUTREACH}
          AND a."occurredAt" >= ${b.start} AND a."occurredAt" < ${b.end}
        GROUP BY a."actorId"
        ORDER BY people DESC
        LIMIT 20`;
      const answered = await c.db.crmEmailMessage.groupBy({
        by: ["mailboxUserId"],
        where: { organizationId: c.organizationId, direction: "INBOUND", createdAt: { gte: b.start, lt: b.end } },
        _count: { _all: true },
      });
      const repliesBy = new Map(answered.map((r) => [r.mailboxUserId, r._count._all]));
      const names = await memberNames(c);
      return {
        type,
        data: {
          rows: rows.map((r) => {
            const bits = [
              Number(r.emails) ? `${r.emails} emails` : null,
              Number(r.calls) ? `${r.calls} calls` : null,
              Number(r.meetings) ? `${r.meetings} meetings` : null,
              repliesBy.get(r.actor) ? `${repliesBy.get(r.actor)} replies` : null,
            ].filter(Boolean);
            return {
              key: r.actor,
              label: names.get(r.actor) ?? "A former member",
              value: Number(r.people),
              display: `${Number(r.people)} ${Number(r.people) === 1 ? "person" : "people"}`,
              detail: bits.join(", ") || null,
            };
          }),
          caption: null,
          empty: "No outreach on the timeline in these dates yet.",
        },
      };
    }
    case "crm-campaigns": {
      const campaigns = await c.db.crmCampaign.findMany({
        where: {
          organizationId: c.organizationId,
          OR: [{ status: "ACTIVE" }, { status: "DONE", updatedAt: { gte: b.start } }],
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, name: true, goalCount: true, dueOn: true },
      });
      const counts = campaigns.length
        ? await c.db.crmCampaignTarget.groupBy({
            by: ["campaignId", "status"],
            where: { organizationId: c.organizationId, campaignId: { in: campaigns.map((x) => x.id) } },
            _count: { _all: true },
          })
        : [];
      return {
        type,
        data: {
          rows: campaigns.map((x) => {
            const of = (s: string[]) => counts.filter((k) => k.campaignId === x.id && s.includes(k.status)).reduce((a, k) => a + k._count._all, 0);
            const total = of(["TODO", "CONTACTED", "REPLIED", "BOOKED", "CONVERTED", "SKIPPED"]);
            const contacted = of(["CONTACTED", "REPLIED", "BOOKED", "CONVERTED"]);
            const goal = x.goalCount ?? total;
            return {
              key: x.id,
              label: x.name,
              value: goal ? Math.min(100, (contacted / goal) * 100) : 0,
              display: `${contacted} of ${goal}`,
              detail: [
                `${of(["REPLIED", "BOOKED", "CONVERTED"])} replied`,
                `${of(["BOOKED", "CONVERTED"])} booked`,
                `${of(["CONVERTED"])} joined`,
                x.dueOn ? `by ${x.dueOn.toISOString().slice(5, 10).replace("-", "/")}` : null,
              ]
                .filter(Boolean)
                .join(", "),
            };
          }),
          max: 100,
          caption: null,
          empty: "No campaigns running.",
        },
      };
    }
    case "crm-conversion":
      return { type, data: await conversion(c) };
    case "crm-time-in-stage":
      return { type, data: await timeInStage(c) };
    case "crm-by-source": {
      const groups = await closedBySource(c);
      const rows = [...groups.entries()]
        .sort((a, b) => b[1].won - a[1].won || b[1].closed - a[1].closed)
        .slice(0, 10)
        .map(([label, g]) => ({
          key: label,
          label,
          value: g.closed ? (g.won / g.closed) * 100 : 0,
          display: `${g.won} of ${g.closed}`,
          detail: `${Math.round(g.closed ? (g.won / g.closed) * 100 : 0)}% won`,
        }));
      return { type, data: { rows, max: 100, caption: null, empty: "Nothing closed in these dates yet." } };
    }
    case "crm-raised-by-source": {
      const groups = await closedBySource(c);
      const rows = [...groups.entries()]
        .filter(([, g]) => g.cents > 0)
        .sort((a, b) => b[1].cents - a[1].cents)
        .slice(0, 10)
        .map(([label, g]) => ({ key: label, label, value: g.cents, display: formatMoney(g.cents), detail: `${g.won} won` }));
      const total = rows.reduce((a, r) => a + r.value, 0);
      return {
        type,
        data: { rows, caption: total ? `${formatMoney(total)} in all` : null, empty: "Nothing won in these dates yet." },
      };
    }
    case "crm-goals": {
      const today = localDateKey(c.now, c.tz);
      const goals = (await listGoals(c.db, c.organizationId, today, { current: true })).filter(
        (g) => c.crm.kind !== "pipeline" || !g.pipelineId || g.pipelineId === c.crm.pipelineId,
      );
      const names = await memberNames(c);
      return {
        type,
        data: {
          rows: goals.map((g) => {
            const money = g.metric === "amount_won";
            const show = (n: number) => (money ? formatMoney(n) : n.toLocaleString("en-US"));
            return {
              key: g.id,
              label: `${g.metricLabel}, ${g.ownerId ? (names.get(g.ownerId) ?? "a member") : "the team"}`,
              value: Math.min(100, g.attainment.share * 100),
              display: `${show(g.attainment.actual)} of ${show(g.target)}`,
              detail: `${g.periodLabel}: ${g.attainment.share >= 1 ? "reached" : g.attainment.onTrack ? "on track" : "behind pace"}`,
            };
          }),
          max: 100,
          caption: null,
          empty: "No goals for this quarter or year. Set them on the CRM's Forecast tab.",
        },
      };
    }
    default:
      // The ready-made reports' widgets (report-ready-widgets.ts).
      return readyWidgetPayload(c, type);
  }
}

/** Which CRM database a report source is (for the catalog), or null. */
export async function crmSourceInfo(
  db: TxClient,
  organizationId: string,
  def: { id: string; kind: string },
): Promise<CrmSourceInfo | null> {
  if (def.kind === "CRM_PEOPLE") return { kind: "people" };
  if (def.kind === "CRM_COMPANIES") return { kind: "companies" };
  if (def.kind !== "CRM_PIPELINE") return null;
  const p = await db.crmPipeline.findFirst({
    where: { organizationId, databaseId: def.id },
    select: { id: true, hasAmount: true },
  });
  return p ? { kind: "pipeline", pipelineId: p.id, hasAmount: p.hasAmount } : null;
}
