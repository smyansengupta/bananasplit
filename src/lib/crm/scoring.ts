import { z } from "zod";

import { CONDITION_OPS, conditionHolds, type RecordValues } from "./workflows";

/**
 * Scoring (docs/features/crm.md, module 9). Pure and client-safe.
 *
 * Rules first: a CrmScoreRule gives points when a field condition holds
 * ("title contains director": +10) or when someone did something within
 * some days ("replied within 30 days": +20). A record's score is the sum,
 * kept between 0 and 100, recomputed by the daily job.
 *
 * Learned later: once an organization has MIN_TRAINING closed items (won
 * and lost), a logistic regression is trained on its own items, nightly, in
 * TypeScript (no paid ML service). Its coefficients are stored as JSON (a
 * CrmScoreRule of objectKind "deals-model", so no new table); an open
 * item's score is then its chance of being won, 0 to 100, with the top
 * reasons beside it.
 */

export const SCORE_OBJECTS = ["people", "deals"] as const;
export type ScoreObject = (typeof SCORE_OBJECTS)[number];

/** The model's row kind (CrmScoreRule.objectKind). */
export const MODEL_KIND = "deals-model";

export const BEHAVIOURS = ["replied", "emailed", "met", "booked", "attended", "rsvped", "form", "called", "paid"] as const;
export type Behaviour = (typeof BEHAVIOURS)[number];

export const BEHAVIOUR_LABELS: Record<Behaviour, string> = {
  replied: "Replied to an email",
  emailed: "Was emailed",
  met: "Had a meeting",
  booked: "Booked a meeting",
  attended: "Checked in at an event",
  rsvped: "RSVPed to an event",
  form: "Filled in a form",
  called: "Had a call",
  paid: "Made a payment",
};

/** Which timeline rows each behaviour counts (CrmActivity kind and direction). */
export const BEHAVIOUR_ACTIVITY: Record<Behaviour, { kind: string; direction?: "INBOUND" | "OUTBOUND"; source?: string }> = {
  replied: { kind: "EMAIL", direction: "INBOUND" },
  emailed: { kind: "EMAIL", direction: "OUTBOUND" },
  met: { kind: "MEETING" },
  booked: { kind: "MEETING", source: "booking" },
  attended: { kind: "CHECK_IN" },
  rsvped: { kind: "RSVP" },
  form: { kind: "FORM_RESPONSE" },
  called: { kind: "CALL" },
  paid: { kind: "PAYMENT" },
};

export const ruleConditionSchema = z.union([
  z
    .object({
      field: z.string().min(1).max(80),
      op: z.enum(CONDITION_OPS),
      value: z.union([z.string().max(200), z.number(), z.boolean(), z.null()]).optional(),
    })
    .strict(),
  z
    .object({
      activity: z.enum(BEHAVIOURS),
      withinDays: z.number().int().min(1).max(730),
      /** At least this many times (default 1). */
      atLeast: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
]);
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export const scoreRuleInputSchema = z
  .object({
    objectKind: z.enum(SCORE_OBJECTS),
    label: z.string().trim().min(1, "Name the rule.").max(120),
    condition: ruleConditionSchema,
    points: z.number().int().min(-100).max(100),
    active: z.boolean().default(true),
  })
  .strict();
export type ScoreRuleInput = z.infer<typeof scoreRuleInputSchema>;

export interface ScoreRule {
  id: string;
  label: string;
  condition: RuleCondition;
  points: number;
}

export function isBehaviour(c: RuleCondition): c is Extract<RuleCondition, { activity: Behaviour }> {
  return "activity" in c;
}

/** Behaviour counts per (behaviour, window): "replied:30" -> 2. */
export type BehaviourCounts = ReadonlyMap<string, number>;

export function behaviourKey(activity: Behaviour, withinDays: number): string {
  return `${activity}:${withinDays}`;
}

/** The rule's points if it holds for this record, else 0. */
export function rulePoints(rule: ScoreRule, values: RecordValues, behaviour: BehaviourCounts): number {
  const c = rule.condition;
  if (isBehaviour(c)) {
    const n = behaviour.get(behaviourKey(c.activity, c.withinDays)) ?? 0;
    return n >= (c.atLeast ?? 1) ? rule.points : 0;
  }
  return conditionHolds({ field: c.field, op: c.op, value: c.value ?? null }, values) ? rule.points : 0;
}

export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** A record's rule score, 0 to 100, and which rules gave it. */
export function scoreRecord(
  rules: readonly ScoreRule[],
  values: RecordValues,
  behaviour: BehaviourCounts,
): { score: number; hits: { label: string; points: number }[] } {
  const hits: { label: string; points: number }[] = [];
  let sum = 0;
  for (const r of rules) {
    const p = rulePoints(r, values, behaviour);
    if (p !== 0) {
      hits.push({ label: r.label, points: p });
      sum += p;
    }
  }
  return { score: clampScore(sum), hits };
}

/** Starter rules an organization can add in one click. */
export const STARTER_RULES: readonly ScoreRuleInput[] = [
  { objectKind: "people", label: "Replied in the last 30 days", condition: { activity: "replied", withinDays: 30 }, points: 25, active: true },
  { objectKind: "people", label: "Came to an event in the last 90 days", condition: { activity: "attended", withinDays: 90 }, points: 20, active: true },
  { objectKind: "people", label: "Met in the last 60 days", condition: { activity: "met", withinDays: 60 }, points: 15, active: true },
  { objectKind: "people", label: "Filled in a form in the last 30 days", condition: { activity: "form", withinDays: 30 }, points: 15, active: true },
  { objectKind: "people", label: "Has a title", condition: { field: "title", op: "not_empty" }, points: 5, active: true },
  { objectKind: "people", label: "Asked not to be contacted", condition: { field: "doNotContact", op: "is", value: true }, points: -100, active: true },
  { objectKind: "deals", label: "Has a next step", condition: { field: "nextStep", op: "not_empty" }, points: 20, active: true },
  { objectKind: "deals", label: "Has a company", condition: { field: "companyId", op: "not_empty" }, points: 10, active: true },
  { objectKind: "deals", label: "Meeting in the last 30 days", condition: { activity: "met", withinDays: 30 }, points: 25, active: true },
  { objectKind: "deals", label: "Reply in the last 30 days", condition: { activity: "replied", withinDays: 30 }, points: 25, active: true },
];

// ---- The learned model ------------------------------------------------------------

/** Closed items needed before a model is trained (and at least MIN_CLASS of each outcome). */
export const MIN_TRAINING = 200;
export const MIN_CLASS = 20;

export interface FeatureDef {
  key: string;
  label: string;
}

/** One item's features (numbers), by FeatureDef key. */
export type Features = Record<string, number>;

export interface TrainedModel {
  version: 1;
  trainedAt: string;
  /** Closed items it learned from, and how many were won. */
  n: number;
  won: number;
  /** Share it got right on items it didn't train on (one in five held back). */
  accuracy: number | null;
  bias: number;
  features: { key: string; label: string; mean: number; std: number; weight: number }[];
}

export function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/**
 * Logistic regression by gradient descent on standardized features, with a
 * little L2 so a rare feature can't run away. Deterministic: same rows,
 * same model.
 */
export function trainLogistic(
  rows: readonly { x: Features; y: 0 | 1 }[],
  defs: readonly FeatureDef[],
  options: { iterations?: number; rate?: number; l2?: number; now?: Date } = {},
): TrainedModel {
  const iterations = options.iterations ?? 600;
  const rate = options.rate ?? 0.3;
  const l2 = options.l2 ?? 0.01;
  // Every fifth row is held back to say how well it does.
  const train = rows.filter((_, i) => i % 5 !== 4);
  const test = rows.filter((_, i) => i % 5 === 4);
  const use = train.length > 0 ? train : rows;
  const stats = defs.map((d) => {
    const vals = use.map((r) => r.x[d.key] ?? 0);
    const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, vals.length);
    return { mean, std: Math.sqrt(variance) || 1 };
  });
  const z = (r: { x: Features }) => defs.map((d, j) => ((r.x[d.key] ?? 0) - stats[j]!.mean) / stats[j]!.std);
  const X = use.map(z);
  const Y = use.map((r) => r.y);
  const w = defs.map(() => 0);
  const positives = Y.reduce<number>((a, b) => a + b, 0);
  let b = Math.log((positives + 1) / (Y.length - positives + 1));
  const n = Math.max(1, X.length);
  for (let it = 0; it < iterations; it++) {
    const grad = w.map(() => 0);
    let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const xi = X[i]!;
      let s = b;
      for (let j = 0; j < w.length; j++) s += w[j]! * xi[j]!;
      const err = sigmoid(s) - Y[i]!;
      gb += err;
      for (let j = 0; j < w.length; j++) grad[j]! += err * xi[j]!;
    }
    b -= (rate * gb) / n;
    for (let j = 0; j < w.length; j++) w[j] = w[j]! - rate * (grad[j]! / n + l2 * w[j]!);
  }
  const model: TrainedModel = {
    version: 1,
    trainedAt: (options.now ?? new Date()).toISOString(),
    n: rows.length,
    won: rows.filter((r) => r.y === 1).length,
    accuracy: null,
    bias: b,
    features: defs.map((d, j) => ({ key: d.key, label: d.label, mean: stats[j]!.mean, std: stats[j]!.std, weight: w[j]! })),
  };
  if (test.length > 0) {
    const right = test.filter((r) => (predict(model, r.x) >= 0.5 ? 1 : 0) === r.y).length;
    model.accuracy = right / test.length;
  }
  return model;
}

/** The chance of winning, 0 to 1. */
export function predict(model: TrainedModel, x: Features): number {
  let s = model.bias;
  for (const f of model.features) s += f.weight * (((x[f.key] ?? 0) - f.mean) / f.std);
  return sigmoid(s);
}

/** What moved this item's chance most, biggest first: "Has a next step" up, "No company" down. */
export function topReasons(model: TrainedModel, x: Features, take = 3): { label: string; direction: "up" | "down"; weight: number }[] {
  return model.features
    .map((f) => ({ label: f.label, contribution: f.weight * (((x[f.key] ?? 0) - f.mean) / f.std) }))
    .filter((r) => Math.abs(r.contribution) > 0.05)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, take)
    .map((r) => ({ label: r.label, direction: r.contribution >= 0 ? ("up" as const) : ("down" as const), weight: r.contribution }));
}

export function readModel(raw: unknown): TrainedModel | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as TrainedModel;
  if (m.version !== 1 || !Array.isArray(m.features) || typeof m.bias !== "number") return null;
  return m;
}

/** The features of an item, from what the server read about it. */
export interface DealFacts {
  amountCents: number | null;
  hasCompany: boolean;
  hasNextStep: boolean;
  people: number;
  emailsIn: number;
  emailsOut: number;
  meetings: number;
  activities: number;
  ageDays: number;
  /** The item's source ("form", "event"...), or null. */
  source: string | null;
  pipelineId: string;
}

/** The model's features: fixed ones, plus one per common source and per pipeline. */
export function featureDefs(sources: readonly string[], pipelines: readonly { id: string; name: string }[]): FeatureDef[] {
  return [
    { key: "amount", label: "Amount" },
    { key: "hasAmount", label: "Has an amount" },
    { key: "hasCompany", label: "Has a company" },
    { key: "hasNextStep", label: "Has a next step" },
    { key: "people", label: "People on it" },
    { key: "emailsIn", label: "Replies" },
    { key: "emailsOut", label: "Emails sent" },
    { key: "meetings", label: "Meetings" },
    { key: "activities", label: "Timeline activity" },
    { key: "age", label: "Time open" },
    ...sources.map((s) => ({ key: `source:${s}`, label: `Came from ${s}` })),
    ...(pipelines.length > 1 ? pipelines.map((p) => ({ key: `pipeline:${p.id}`, label: `In ${p.name}` })) : []),
  ];
}

export function featuresOf(f: DealFacts, defs: readonly FeatureDef[]): Features {
  const x: Features = {
    amount: Math.log1p(Math.max(0, (f.amountCents ?? 0) / 100)),
    hasAmount: f.amountCents ? 1 : 0,
    hasCompany: f.hasCompany ? 1 : 0,
    hasNextStep: f.hasNextStep ? 1 : 0,
    people: Math.min(10, f.people),
    emailsIn: Math.log1p(f.emailsIn),
    emailsOut: Math.log1p(f.emailsOut),
    meetings: Math.log1p(f.meetings),
    activities: Math.log1p(f.activities),
    age: Math.log1p(Math.max(0, f.ageDays)),
  };
  for (const d of defs) {
    if (d.key.startsWith("source:")) x[d.key] = f.source === d.key.slice(7) ? 1 : 0;
    if (d.key.startsWith("pipeline:")) x[d.key] = f.pipelineId === d.key.slice(9) ? 1 : 0;
  }
  return x;
}
