import { dealTypeField, dealTypeOf } from "@/lib/crm/deals-tab";
import { monthKeys, median, type SendCell } from "@/lib/crm/crm-reports";
import { formatMoney } from "@/lib/crm/fields";
import type { ChoiceColor } from "@/lib/databases/fields";
import type { CrmStatPayload } from "@/lib/reports/crm-widgets";
import { dayBounds, localDateKey } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";

import { customFieldsFor } from "./databases";
import { listGoals } from "./goals";
import { ownerLabel, type RoleOwner } from "./owners";
import { crmWidgetPayload } from "./report-widgets";

/**
 * The numbers behind the CRM's reports (/crm/reports): Deals (one
 * pipeline), People and Outreach, over the range the date pills pick, read
 * as the viewer (RLS decides the rows).
 */

const DAY = 86_400_000;
const QUIET_DAYS = 60;

export interface ReportCtx {
  db: TxClient;
  organizationId: string;
  slug: string;
  tz: string;
  range: { from: string | null; to: string | null };
  now: Date;
  roles: ReadonlyMap<string, RoleOwner>;
  names: ReadonlyMap<string, string>;
}

interface Bounds {
  start: Date;
  end: Date;
}

/** The range as instants (all time: no lower bound). */
function bounds(c: ReportCtx): Bounds {
  return {
    start: c.range.from ? dayBounds(c.range.from, c.tz).start : new Date(0),
    end: c.range.to ? dayBounds(c.range.to, c.tz).end : new Date(c.now.getTime() + DAY),
  };
}

/** The span just before, as long (null for all time). */
function before(c: ReportCtx, b: Bounds): Bounds | null {
  if (!c.range.from) return null;
  const len = b.end.getTime() - b.start.getTime();
  return { start: new Date(b.start.getTime() - len), end: b.start };
}

const inside = (d: Date | null, b: Bounds) => Boolean(d && d >= b.start && d < b.end);
const monthOf = (d: Date, tz: string) => localDateKey(d, tz).slice(0, 7);

// ---- Deals ------------------------------------------------------------------------------

export interface DealsReport {
  pipeline: { id: string; name: string; hasAmount: boolean; currency: string };
  won: { cents: number; count: number; previousCents: number | null; goal: { target: number; share: number } | null };
  open: { cents: number; count: number; withStep: number };
  months: { key: string; cents: number }[];
  byStage: { id: string; name: string; kind: "OPEN" | "WON" | "LOST"; cents: number; count: number }[];
  byOwner: { name: string; cents: number; count: number }[];
  byType: { label: string; color: ChoiceColor | null; cents: number; count: number }[];
  late: { id: string; title: string }[];
  noStep: { id: string; title: string }[];
  likelyCents: number;
}

export async function dealsReport(
  c: ReportCtx,
  pipeline: {
    id: string;
    name: string;
    hasAmount: boolean;
    currency: string;
    stages: { id: string; name: string; kind: "OPEN" | "WON" | "LOST"; probability: number | null }[];
  },
): Promise<DealsReport> {
  const b = bounds(c);
  const prev = before(c, b);
  const today = localDateKey(c.now, c.tz);
  // One query at a time: they share the viewer's transaction.
  const deals = await c.db.crmDeal.findMany({
      where: { organizationId: c.organizationId, pipelineId: pipeline.id, deletedAt: null },
      take: 5000,
      select: {
        id: true,
        title: true,
        amountCents: true,
        stageId: true,
        closedAt: true,
        ownerId: true,
        ownerRoleKey: true,
        nextStep: true,
        nextStepAt: true,
        expectedOn: true,
        custom: true,
        stage: { select: { kind: true } },
      },
    });
  const fields = await customFieldsFor(c.db, c.organizationId, "deal", pipeline.id);
  const goals = await listGoals(c.db, c.organizationId, today, { current: true });
  const typeField = dealTypeField(fields);
  const amount = (d: { amountCents: number | null }) => d.amountCents ?? 0;
  const won = deals.filter((d) => d.stage.kind === "WON" && inside(d.closedAt, b));
  const open = deals.filter((d) => d.stage.kind === "OPEN");
  const wonCents = won.reduce((n, d) => n + amount(d), 0);
  const previousCents = prev
    ? deals.filter((d) => d.stage.kind === "WON" && inside(d.closedAt, prev)).reduce((n, d) => n + amount(d), 0)
    : null;
  const goal =
    goals.find((g) => g.metric === "amount_won" && !g.ownerId && (!g.pipelineId || g.pipelineId === pipeline.id)) ??
    null;

  const keys = monthKeys(c.range.from, c.range.to, today);
  const perMonth = new Map(keys.map((k) => [k, 0]));
  for (const d of deals) {
    if (d.stage.kind !== "WON" || !d.closedAt) continue;
    const k = monthOf(d.closedAt, c.tz);
    if (perMonth.has(k)) perMonth.set(k, perMonth.get(k)! + amount(d));
  }

  // Where the money sits now: every open deal, and what closed in the range.
  const sitting = deals.filter((d) => d.stage.kind === "OPEN" || inside(d.closedAt, b));
  const byStage = pipeline.stages.map((s) => {
    const list = sitting.filter((d) => d.stageId === s.id);
    return { id: s.id, name: s.name, kind: s.kind, cents: list.reduce((n, d) => n + amount(d), 0), count: list.length };
  });

  const owners = new Map<string, { cents: number; count: number }>();
  for (const d of won) {
    const name = ownerLabel(d, c.roles, c.names) ?? "Nobody";
    const o = owners.get(name) ?? { cents: 0, count: 0 };
    o.cents += amount(d);
    o.count += 1;
    owners.set(name, o);
  }

  const types = new Map<string, { label: string; color: ChoiceColor | null; cents: number; count: number }>();
  for (const d of sitting) {
    if (d.stage.kind === "LOST") continue;
    const t = dealTypeOf(typeField, d.custom);
    const key = t?.label ?? "No type";
    const v = types.get(key) ?? { label: key, color: t?.color ?? null, cents: 0, count: 0 };
    v.cents += amount(d);
    v.count += 1;
    types.set(key, v);
  }
  const typeOrder = typeField?.options.choices?.map((ch) => ch.label) ?? [];
  const byType = [...types.values()].sort(
    (x, y) => (typeOrder.indexOf(x.label) + 1 || 99) - (typeOrder.indexOf(y.label) + 1 || 99),
  );

  const startOfToday = dayBounds(today, c.tz).start;
  const prob = new Map(pipeline.stages.map((s) => [s.id, (s.probability ?? 0) / 100]));
  const periodEnd = c.range.to ? dayBounds(c.range.to, c.tz).end : null;
  return {
    pipeline: { id: pipeline.id, name: pipeline.name, hasAmount: pipeline.hasAmount, currency: pipeline.currency },
    won: {
      cents: wonCents,
      count: won.length,
      previousCents,
      goal: goal ? { target: goal.target, share: goal.target > 0 ? wonCents / goal.target : 0 } : null,
    },
    open: {
      cents: open.reduce((n, d) => n + amount(d), 0),
      count: open.length,
      withStep: open.filter((d) => d.nextStep?.trim() && d.nextStepAt).length,
    },
    months: keys.map((key) => ({ key, cents: perMonth.get(key) ?? 0 })),
    byStage,
    byOwner: [...owners.entries()].map(([name, v]) => ({ name, ...v })).sort((x, y) => y.cents - x.cents),
    byType,
    late: open
      .filter((d) => d.nextStep?.trim() && d.nextStepAt && d.nextStepAt < startOfToday)
      .slice(0, 3)
      .map((d) => ({ id: d.id, title: d.title })),
    noStep: open.filter((d) => !d.nextStep?.trim()).slice(0, 3).map((d) => ({ id: d.id, title: d.title })),
    // Open deals expected by the range's end, weighted by their stage's likelihood.
    likelyCents: Math.round(
      open
        .filter((d) => !periodEnd || (d.expectedOn && d.expectedOn < periodEnd))
        .reduce((n, d) => n + amount(d) * (prob.get(d.stageId) ?? 0), 0),
    ),
  };
}

// ---- People -----------------------------------------------------------------------------

export interface PeopleReport {
  total: number;
  months: { key: string; count: number }[];
  addedInRange: number;
  quiet: { count: number; people: { id: string; name: string; days: number; relationship: string | null }[]; ids: string[] };
  byRelationship: { label: string; count: number }[];
  byOwner: { name: string; count: number; nobody: boolean }[];
  fastest: { id: string; name: string; relationship: string | null; hours: number }[];
  everyoneHours: number | null;
}

export async function peopleReport(c: ReportCtx, relationships: ReadonlyMap<string, string>): Promise<PeopleReport> {
  const b = bounds(c);
  const today = localDateKey(c.now, c.tz);
  const people = await c.db.crmPerson.findMany({
    where: { organizationId: c.organizationId, deletedAt: null, status: "ACTIVE" },
    take: 20_000,
    select: {
      id: true,
      name: true,
      createdAt: true,
      relationship: true,
      ownerId: true,
      ownerRoleKey: true,
      lastContactedAt: true,
      nextFollowUpAt: true,
      doNotContact: true,
    },
  });
  const rel = (id: string | null) => (id ? (relationships.get(id) ?? null) : null);
  const keys = monthKeys(c.range.from, c.range.to, today);
  const perMonth = new Map(keys.map((k) => [k, 0]));
  for (const p of people) {
    const k = monthOf(p.createdAt, c.tz);
    if (perMonth.has(k)) perMonth.set(k, perMonth.get(k)! + 1);
  }
  const cutoff = new Date(c.now.getTime() - QUIET_DAYS * DAY);
  const quiet = people
    .filter((p) => !p.doNotContact && p.lastContactedAt && p.lastContactedAt < cutoff)
    .map((p) => ({ ...p, days: Math.floor((c.now.getTime() - p.lastContactedAt!.getTime()) / DAY) }))
    .sort((x, y) => x.days - y.days);

  const rels = new Map<string, number>();
  for (const p of people) {
    const label = rel(p.relationship) ?? "No relationship";
    rels.set(label, (rels.get(label) ?? 0) + 1);
  }
  const owners = new Map<string, number>();
  for (const p of people) {
    const name = ownerLabel(p, c.roles, c.names) ?? "Nobody yet";
    owners.set(name, (owners.get(name) ?? 0) + 1);
  }

  // How fast they write back to us: per person, the middle of their replies.
  const replies = await c.db.crmEmailMessage.findMany({
    where: {
      organizationId: c.organizationId,
      direction: "OUTBOUND",
      personId: { not: null },
      sentAt: { gte: b.start, lt: b.end },
      repliedAt: { not: null },
    },
    take: 20_000,
    select: { personId: true, sentAt: true, repliedAt: true },
  });
  const per = new Map<string, number[]>();
  for (const m of replies) {
    if (!m.sentAt || !m.repliedAt || m.repliedAt < m.sentAt) continue;
    const hours = (m.repliedAt.getTime() - m.sentAt.getTime()) / 3_600_000;
    const list = per.get(m.personId!) ?? [];
    list.push(hours);
    per.set(m.personId!, list);
  }
  const byId = new Map(people.map((p) => [p.id, p]));
  const fastest = [...per.entries()]
    .map(([id, hs]) => ({ id, hours: median(hs)! }))
    .filter((f) => byId.has(f.id))
    .sort((x, y) => x.hours - y.hours)
    .slice(0, 5)
    .map((f) => ({ ...f, name: byId.get(f.id)!.name, relationship: rel(byId.get(f.id)!.relationship) }));
  const top = new Set(fastest.map((f) => f.id));
  const everyone = median([...per.entries()].filter(([id]) => !top.has(id)).flatMap(([, hs]) => hs));

  return {
    total: people.length,
    months: keys.map((key) => ({ key, count: perMonth.get(key) ?? 0 })),
    addedInRange: people.filter((p) => inside(p.createdAt, b)).length,
    quiet: {
      count: quiet.length,
      people: [...quiet]
        .reverse()
        .slice(0, 3)
        .map((p) => ({ id: p.id, name: p.name, days: p.days, relationship: rel(p.relationship) })),
      // Power hour picks these up: the quiet ones with no follow-up set yet.
      ids: quiet.filter((p) => !p.nextFollowUpAt).slice(-25).map((p) => p.id),
    },
    byRelationship: [...rels.entries()].map(([label, count]) => ({ label, count })).sort((x, y) => y.count - x.count),
    byOwner: [...owners.entries()]
      .map(([name, count]) => ({ name, count, nobody: name === "Nobody yet" }))
      .sort((x, y) => Number(x.nobody) - Number(y.nobody) || y.count - x.count),
    fastest,
    everyoneHours: everyone,
  };
}

// ---- Outreach ---------------------------------------------------------------------------

export interface OutreachReport {
  sent: { total: number; emails: number; texts: number; bounced: number; previous: number | null };
  replyRate: CrmStatPayload | null;
  emailRate: number | null;
  byPlan: { name: string; sent: number; replied: number }[];
  cells: SendCell[];
  unsubscribes: { count: number; byPlan: { name: string; count: number }[] };
}

export async function outreachReport(c: ReportCtx): Promise<OutreachReport> {
  const b = bounds(c);
  const prev = before(c, b);
  const org = c.organizationId;
  const sentWhere = (x: Bounds) => ({
    organizationId: org,
    direction: "OUTBOUND" as const,
    status: { in: ["SENT" as const, "BOUNCED" as const] },
    sentAt: { gte: x.start, lt: x.end },
  });
  const textsIn = (x: Bounds) =>
    c.db.crmActivity.count({
      where: { organizationId: org, kind: "TEXT", direction: "OUTBOUND", deletedAt: null, occurredAt: { gte: x.start, lt: x.end } },
    });
  const emails = await c.db.crmEmailMessage.count({ where: sentWhere(b) });
  const bounced = await c.db.crmEmailMessage.count({ where: { ...sentWhere(b), status: "BOUNCED" } });
  const replied = await c.db.crmEmailMessage.count({ where: { ...sentWhere(b), repliedAt: { not: null } } });
  const texts = await textsIn(b);
  const previous = prev ? (await c.db.crmEmailMessage.count({ where: sentWhere(prev) })) + (await textsIn(prev)) : null;

  const rate = await crmWidgetPayload(
    { db: c.db, organizationId: org, slug: c.slug, tz: c.tz, range: c.range, crm: { kind: "people" }, now: c.now },
    "crm-reply-rate",
  );

  const plans = await c.db.$queryRaw<{ name: string; sent: bigint; replied: bigint }[]>`
    SELECT COALESCE(s.name, k.name) AS name, COUNT(*) AS sent, COUNT(m."repliedAt") AS replied
    FROM "CrmEmailMessage" m
    LEFT JOIN "CrmEnrollment" e ON e.id = m."enrollmentId"
    LEFT JOIN "CrmSequence" s ON s.id = e."sequenceId"
    LEFT JOIN "CrmCampaign" k ON k.id = m."campaignId"
    WHERE m."organizationId" = ${org} AND m.direction = 'OUTBOUND' AND m.status IN ('SENT', 'BOUNCED')
      AND m."sentAt" >= ${b.start} AND m."sentAt" < ${b.end}
      AND (s.name IS NOT NULL OR k.name IS NOT NULL)
    GROUP BY 1
    ORDER BY replied DESC, sent DESC
    LIMIT 8`;

  const cells = await c.db.$queryRaw<{ dow: number; hour: number; sent: bigint; replied: bigint }[]>`
    SELECT EXTRACT(DOW FROM m."sentAt" AT TIME ZONE ${c.tz})::int AS dow,
      EXTRACT(HOUR FROM m."sentAt" AT TIME ZONE ${c.tz})::int AS hour,
      COUNT(*) AS sent, COUNT(m."repliedAt") AS replied
    FROM "CrmEmailMessage" m
    WHERE m."organizationId" = ${org} AND m.direction = 'OUTBOUND' AND m.status = 'SENT'
      AND m."sentAt" >= ${b.start} AND m."sentAt" < ${b.end}
    GROUP BY 1, 2`;

  const unsubs = await c.db.$queryRaw<{ name: string | null }[]>`
    SELECT plan.name
    FROM "CrmPerson" p
    LEFT JOIN LATERAL (
      SELECT COALESCE(s.name, k.name) AS name
      FROM "CrmEmailMessage" m
      LEFT JOIN "CrmEnrollment" e ON e.id = m."enrollmentId"
      LEFT JOIN "CrmSequence" s ON s.id = e."sequenceId"
      LEFT JOIN "CrmCampaign" k ON k.id = m."campaignId"
      WHERE m."organizationId" = ${org} AND m."personId" = p.id AND m.direction = 'OUTBOUND'
        AND m."sentAt" <= p."unsubscribedAt"
      ORDER BY m."sentAt" DESC
      LIMIT 1
    ) plan ON TRUE
    WHERE p."organizationId" = ${org} AND p."deletedAt" IS NULL
      AND p."unsubscribedAt" >= ${b.start} AND p."unsubscribedAt" < ${b.end}
    LIMIT 5000`;
  const unsubPlans = new Map<string, number>();
  for (const u of unsubs) {
    const name = u.name ?? "One-to-one email";
    unsubPlans.set(name, (unsubPlans.get(name) ?? 0) + 1);
  }

  return {
    sent: { total: emails + texts, emails, texts, bounced, previous },
    replyRate: rate && rate.type === "crm-reply-rate" ? (rate.data as CrmStatPayload) : null,
    emailRate: emails ? replied / emails : null,
    byPlan: plans.map((p) => ({ name: p.name, sent: Number(p.sent), replied: Number(p.replied) })),
    cells: cells.map((x) => ({ dow: x.dow, hour: x.hour, sent: Number(x.sent), replied: Number(x.replied) })),
    unsubscribes: {
      count: unsubs.length,
      byPlan: [...unsubPlans.entries()].map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count),
    },
  };
}

/** "$18,500" or "12" for a deals figure, money where the pipeline has it. */
export function dealsFigure(report: Pick<DealsReport, "pipeline">, cents: number, count: number): string {
  return report.pipeline.hasAmount ? formatMoney(cents, report.pipeline.currency) : count.toLocaleString("en-US");
}
