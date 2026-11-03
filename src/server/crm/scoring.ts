import { Prisma } from "@/generated/prisma/client";
import {
  BEHAVIOUR_ACTIVITY,
  behaviourKey,
  featureDefs,
  featuresOf,
  isBehaviour,
  MIN_CLASS,
  MIN_TRAINING,
  MODEL_KIND,
  predict,
  readModel,
  ruleConditionSchema,
  scoreRecord,
  scoreRuleInputSchema,
  topReasons,
  trainLogistic,
  type Behaviour,
  type DealFacts,
  type ScoreObject,
  type ScoreRule,
  type TrainedModel,
} from "@/lib/crm/scoring";
import type { TxClient } from "@/server/db/context";

import { CrmError, requireCrm, requireManager, type CrmActor } from "./access";
import { dealValues, personValues } from "./workflow-target";

/**
 * Scores (docs/features/crm.md, module 9), the server half: the rules
 * recomputed in pages by the daily job and written straight to the score
 * column (no field history: a score is computed, not edited), and the
 * learned model trained nightly once there are enough closed items. See
 * src/lib/crm/scoring.ts for the maths.
 */

const DAY = 86_400_000;
const PAGE = 500;

export async function loadRules(db: TxClient, organizationId: string, objectKind: ScoreObject): Promise<ScoreRule[]> {
  const rows = await db.crmScoreRule.findMany({
    where: { organizationId, objectKind, active: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.flatMap((r) => {
    const c = ruleConditionSchema.safeParse(r.condition);
    return c.success ? [{ id: r.id, label: r.label, condition: c.data, points: r.points }] : [];
  });
}

/** How often each record did each behaviour within each window the rules ask about. */
async function behaviourCounts(
  db: TxClient,
  organizationId: string,
  targetKind: "person" | "deal",
  ids: readonly string[],
  windows: readonly { activity: Behaviour; withinDays: number }[],
  now: Date,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (ids.length === 0) return out;
  for (const w of windows) {
    const spec = BEHAVIOUR_ACTIVITY[w.activity];
    const since = new Date(now.getTime() - w.withinDays * DAY);
    const rows = await db.$queryRaw<{ id: string; n: bigint }[]>`
      SELECT t."targetId" AS id, COUNT(*) AS n
      FROM "CrmActivityTarget" t JOIN "CrmActivity" a ON a.id = t."activityId"
      WHERE t."organizationId" = ${organizationId} AND t."targetKind" = ${targetKind}
        AND t."targetId" IN (${Prisma.join(ids)})
        AND a."deletedAt" IS NULL AND a.kind::text = ${spec.kind}
        ${spec.direction ? Prisma.sql`AND a.direction::text = ${spec.direction}` : Prisma.empty}
        ${spec.source ? Prisma.sql`AND a."sourceKind" ILIKE ${`${spec.source}%`}` : Prisma.empty}
        AND t."occurredAt" >= ${since}
      GROUP BY t."targetId"`;
    const key = behaviourKey(w.activity, w.withinDays);
    for (const r of rows) {
      const m = out.get(r.id) ?? new Map<string, number>();
      m.set(key, Number(r.n));
      out.set(r.id, m);
    }
  }
  return out;
}

function windowsOf(rules: readonly ScoreRule[]) {
  const seen = new Map<string, { activity: Behaviour; withinDays: number }>();
  for (const r of rules) {
    if (isBehaviour(r.condition)) seen.set(behaviourKey(r.condition.activity, r.condition.withinDays), r.condition);
  }
  return [...seen.values()];
}

async function writeScores(db: TxClient, table: "CrmPerson" | "CrmDeal", organizationId: string, changed: { id: string; score: number }[]) {
  if (changed.length === 0) return;
  const values = Prisma.join(changed.map((c) => Prisma.sql`(${c.id}, ${c.score}::int)`));
  const t = Prisma.raw(`"${table}"`);
  await db.$executeRaw`
    UPDATE ${t} AS x SET score = v.score
    FROM (VALUES ${values}) AS v(id, score)
    WHERE x.id = v.id AND x."organizationId" = ${organizationId}`;
}

/**
 * One page of people, then items: their rule scores (items: the model's
 * chance when there is one). Returns where to carry on, or null when done.
 */
export async function recomputeScoresPage(
  db: TxClient,
  organizationId: string,
  cursor: string | null,
  now: Date = new Date(),
): Promise<{ cursor: string | null; written: number }> {
  // The cursor is "p:<id>" through people, then "d:<id>" through items.
  const phase = cursor?.startsWith("d:") ? "deals" : "people";
  const after = cursor ? cursor.slice(2) : null;
  if (phase === "people") {
    const rules = await loadRules(db, organizationId, "people");
    const rows = await db.crmPerson.findMany({
      where: { organizationId, deletedAt: null, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: "asc" },
      take: PAGE,
      include: { company: { select: { name: true } } },
    });
    const counts = await behaviourCounts(db, organizationId, "person", rows.map((r) => r.id), windowsOf(rules), now);
    const changed: { id: string; score: number }[] = [];
    for (const p of rows) {
      const score = rules.length ? scoreRecord(rules, personValues(p), counts.get(p.id) ?? new Map()).score : 0;
      if (score !== p.score) changed.push({ id: p.id, score });
    }
    await writeScores(db, "CrmPerson", organizationId, changed);
    return { cursor: rows.length < PAGE ? "d:" : `p:${rows[rows.length - 1]!.id}`, written: changed.length };
  }
  const rules = await loadRules(db, organizationId, "deals");
  const model = await loadModel(db, organizationId);
  const rows = await db.crmDeal.findMany({
    where: { organizationId, deletedAt: null, closedAt: null, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" },
    take: PAGE,
    include: { company: { select: { name: true } }, stage: { select: { name: true, kind: true } } },
  });
  const counts = await behaviourCounts(db, organizationId, "deal", rows.map((r) => r.id), windowsOf(rules), now);
  const facts = model ? await dealFacts(db, organizationId, rows, now) : new Map<string, DealFacts>();
  const defs = model?.features.map((f) => ({ key: f.key, label: f.label })) ?? [];
  const changed: { id: string; score: number }[] = [];
  for (const d of rows) {
    let score = 0;
    if (model && facts.get(d.id)) score = Math.round(predict(model, featuresOf(facts.get(d.id)!, defs)) * 100);
    else if (rules.length) score = scoreRecord(rules, dealValues(d), counts.get(d.id) ?? new Map()).score;
    if (score !== d.score) changed.push({ id: d.id, score });
  }
  await writeScores(db, "CrmDeal", organizationId, changed);
  return { cursor: rows.length < PAGE ? null : `d:${rows[rows.length - 1]!.id}`, written: changed.length };
}

// ---- Facts for the model ---------------------------------------------------------------

type FactRow = { id: string; amountCents: number | null; companyId: string | null; nextStep: string | null; createdAt: Date; closedAt: Date | null; source: string | null; pipelineId: string };

/** Each item's features, counting only what happened before it closed (or until now). */
export async function dealFacts(
  db: TxClient,
  organizationId: string,
  deals: readonly FactRow[],
  now: Date,
): Promise<Map<string, DealFacts>> {
  const out = new Map<string, DealFacts>();
  if (deals.length === 0) return out;
  const ids = deals.map((d) => d.id);
  const acts = await db.$queryRaw<{ id: string; emails_in: bigint; emails_out: bigint; meetings: bigint; total: bigint }[]>`
    SELECT t."targetId" AS id,
      COUNT(*) FILTER (WHERE a.kind = 'EMAIL' AND a.direction = 'INBOUND') AS emails_in,
      COUNT(*) FILTER (WHERE a.kind = 'EMAIL' AND a.direction = 'OUTBOUND') AS emails_out,
      COUNT(*) FILTER (WHERE a.kind = 'MEETING') AS meetings,
      COUNT(*) FILTER (WHERE a.kind NOT IN ('STAGE_CHANGE', 'FIELD_CHANGE', 'SYSTEM')) AS total
    FROM "CrmActivityTarget" t
    JOIN "CrmActivity" a ON a.id = t."activityId"
    JOIN "CrmDeal" d ON d.id = t."targetId" AND d."organizationId" = t."organizationId"
    WHERE t."organizationId" = ${organizationId} AND t."targetKind" = 'deal' AND t."targetId" IN (${Prisma.join(ids)})
      AND a."deletedAt" IS NULL AND t."occurredAt" <= COALESCE(d."closedAt", ${now})
    GROUP BY t."targetId"`;
  const byId = new Map(acts.map((a) => [a.id, a]));
  const people = await db.crmDealPerson.groupBy({
    by: ["dealId"],
    where: { organizationId, dealId: { in: ids } },
    _count: { _all: true },
  });
  const peopleBy = new Map(people.map((p) => [p.dealId, p._count._all]));
  for (const d of deals) {
    const a = byId.get(d.id);
    out.set(d.id, {
      amountCents: d.amountCents,
      hasCompany: Boolean(d.companyId),
      hasNextStep: Boolean(d.nextStep?.trim()),
      people: peopleBy.get(d.id) ?? 0,
      emailsIn: Number(a?.emails_in ?? 0),
      emailsOut: Number(a?.emails_out ?? 0),
      meetings: Number(a?.meetings ?? 0),
      activities: Number(a?.total ?? 0),
      ageDays: ((d.closedAt ?? now).getTime() - d.createdAt.getTime()) / DAY,
      source: d.source?.trim().toLowerCase() || null,
      pipelineId: d.pipelineId,
    });
  }
  return out;
}

export async function loadModel(db: TxClient, organizationId: string): Promise<TrainedModel | null> {
  const row = await db.crmScoreRule.findFirst({
    where: { organizationId, objectKind: MODEL_KIND, active: true },
    select: { condition: true },
  });
  return row ? readModel(row.condition) : null;
}

/** Trains the organization's model when it has enough closed items; stores it. */
export async function trainModel(
  db: TxClient,
  organizationId: string,
  now: Date = new Date(),
): Promise<{ trained: boolean; n: number; reason?: string }> {
  const closed = await db.crmDeal.findMany({
    where: { organizationId, deletedAt: null, closedAt: { not: null }, stage: { kind: { in: ["WON", "LOST"] } } },
    orderBy: { closedAt: "desc" },
    take: 5000,
    select: {
      id: true,
      amountCents: true,
      companyId: true,
      nextStep: true,
      createdAt: true,
      closedAt: true,
      source: true,
      pipelineId: true,
      stage: { select: { kind: true } },
    },
  });
  const won = closed.filter((d) => d.stage.kind === "WON").length;
  if (closed.length < MIN_TRAINING || won < MIN_CLASS || closed.length - won < MIN_CLASS) {
    return { trained: false, n: closed.length, reason: `Needs ${MIN_TRAINING} closed items, ${MIN_CLASS} won and ${MIN_CLASS} lost.` };
  }
  const facts = await dealFacts(db, organizationId, closed, now);
  const sourceCounts = new Map<string, number>();
  for (const f of facts.values()) if (f.source) sourceCounts.set(f.source, (sourceCounts.get(f.source) ?? 0) + 1);
  const sources = [...sourceCounts.entries()].filter(([, n]) => n >= 10).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s);
  const pipelines = await db.crmPipeline.findMany({
    where: { organizationId, id: { in: [...new Set(closed.map((d) => d.pipelineId))] } },
    select: { id: true, name: true },
  });
  const defs = featureDefs(sources, pipelines);
  // Oldest first, so the held-back fifth is spread over time.
  const rows = closed
    .slice()
    .reverse()
    .map((d) => ({ x: featuresOf(facts.get(d.id)!, defs), y: (d.stage.kind === "WON" ? 1 : 0) as 0 | 1 }));
  const model = trainLogistic(rows, defs, { now });
  const existing = await db.crmScoreRule.findFirst({ where: { organizationId, objectKind: MODEL_KIND }, select: { id: true } });
  const data = { condition: model as unknown as Prisma.InputJsonObject, active: true, label: "Learned from your closed items", points: 0 };
  if (existing) await db.crmScoreRule.update({ where: { id: existing.id }, data });
  else await db.crmScoreRule.create({ data: { organizationId, objectKind: MODEL_KIND, ...data } });
  return { trained: true, n: closed.length };
}

/** Why an item scores what it does: the model's top reasons, or the rules that gave it points. */
export async function scoreReasons(
  db: TxClient,
  organizationId: string,
  kind: "person" | "deal",
  id: string,
  now: Date = new Date(),
): Promise<{ by: "model" | "rules" | "none"; reasons: { label: string; direction: "up" | "down" }[]; accuracy: number | null }> {
  if (kind === "deal") {
    const model = await loadModel(db, organizationId);
    const d = await db.crmDeal.findFirst({
      where: { id, organizationId },
      include: { company: { select: { name: true } }, stage: { select: { name: true, kind: true } } },
    });
    if (!d) return { by: "none", reasons: [], accuracy: null };
    if (model && !d.closedAt) {
      const f = (await dealFacts(db, organizationId, [d], now)).get(d.id)!;
      const defs = model.features.map((x) => ({ key: x.key, label: x.label }));
      return {
        by: "model",
        reasons: topReasons(model, featuresOf(f, defs)).map((r) => ({ label: r.label, direction: r.direction })),
        accuracy: model.accuracy,
      };
    }
    const rules = await loadRules(db, organizationId, "deals");
    const counts = await behaviourCounts(db, organizationId, "deal", [d.id], windowsOf(rules), now);
    const hits = scoreRecord(rules, dealValues(d), counts.get(d.id) ?? new Map()).hits;
    return { by: hits.length ? "rules" : "none", reasons: hits.map((h) => ({ label: h.label, direction: h.points >= 0 ? "up" : "down" })), accuracy: null };
  }
  const p = await db.crmPerson.findFirst({ where: { id, organizationId }, include: { company: { select: { name: true } } } });
  if (!p) return { by: "none", reasons: [], accuracy: null };
  const rules = await loadRules(db, organizationId, "people");
  const counts = await behaviourCounts(db, organizationId, "person", [p.id], windowsOf(rules), now);
  const hits = scoreRecord(rules, personValues(p), counts.get(p.id) ?? new Map()).hits;
  return { by: hits.length ? "rules" : "none", reasons: hits.map((h) => ({ label: h.label, direction: h.points >= 0 ? "up" : "down" })), accuracy: null };
}

// ---- Editing rules (managers) -------------------------------------------------------------

export async function saveScoreRule(actor: CrmActor, input: { id?: string | null; rule: unknown }): Promise<{ id: string }> {
  requireManager(await requireCrm(actor));
  const parsed = scoreRuleInputSchema.safeParse(input.rule);
  if (!parsed.success) throw new CrmError(parsed.error.issues[0]?.message ?? "Something in the rule isn't right.");
  const r = parsed.data;
  const { db, organizationId } = actor;
  const data = {
    objectKind: r.objectKind,
    label: r.label,
    condition: r.condition as unknown as Prisma.InputJsonObject,
    points: r.points,
    active: r.active,
  };
  if (input.id) {
    const found = await db.crmScoreRule.findFirst({
      where: { id: input.id, organizationId, objectKind: { not: MODEL_KIND } },
      select: { id: true },
    });
    if (!found) throw new CrmError("That rule isn't there any more.");
    await db.crmScoreRule.update({ where: { id: found.id }, data });
    return found;
  }
  const n = await db.crmScoreRule.count({ where: { organizationId, objectKind: r.objectKind } });
  if (n >= 50) throw new CrmError("50 rules is the most. Remove one first.");
  return db.crmScoreRule.create({ data: { organizationId, ...data }, select: { id: true } });
}

export async function deleteScoreRule(actor: CrmActor, id: string): Promise<void> {
  requireManager(await requireCrm(actor));
  await actor.db.crmScoreRule.deleteMany({ where: { id, organizationId: actor.organizationId, objectKind: { not: MODEL_KIND } } });
}

export async function listScoreRules(db: TxClient, organizationId: string) {
  const rows = await db.crmScoreRule.findMany({
    where: { organizationId, objectKind: { in: ["people", "deals"] } },
    orderBy: [{ objectKind: "asc" }, { createdAt: "asc" }],
  });
  return rows.flatMap((r) => {
    const c = ruleConditionSchema.safeParse(r.condition);
    return c.success
      ? [{ id: r.id, objectKind: r.objectKind as ScoreObject, label: r.label, condition: c.data, points: r.points, active: r.active }]
      : [];
  });
}

/** What the model page says: trained or not, on how many, how often it's right. */
export async function modelStatus(db: TxClient, organizationId: string) {
  const model = await loadModel(db, organizationId);
  const closed = await db.crmDeal.count({
    where: { organizationId, deletedAt: null, closedAt: { not: null }, stage: { kind: { in: ["WON", "LOST"] } } },
  });
  return {
    trained: Boolean(model),
    trainedAt: model?.trainedAt ?? null,
    n: model?.n ?? 0,
    accuracy: model?.accuracy ?? null,
    closed,
    needs: MIN_TRAINING,
    top: model
      ? model.features
          .slice()
          .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
          .slice(0, 5)
          .map((f) => ({ label: f.label, direction: f.weight >= 0 ? ("up" as const) : ("down" as const) }))
      : [],
  };
}
