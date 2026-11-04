import type { ChoiceColor, FieldDef } from "@/lib/databases/fields";

/**
 * Deals on People (docs/features/crm.md, "One list"): the Board view, the
 * Stage and Deal value columns, and the deal filters (pipeline, stage,
 * owner, type, what to show) with search. Pure, so the page, the board and
 * the tests read the URL and decide a deal's ambient buttons the same way.
 *
 * A deal's type (New, Renewal, Partnership, Grant) is a single-select custom
 * field named "Type" on its pipeline's database, so it shows in Databases,
 * imports, reports and automations like any other field. No schema of its
 * own: the field is added the first time someone picks a type.
 */

export type DealsView = "list" | "board";
export type DealsShow = "open" | "won" | "lost" | "all";

export interface DealsFilters {
  view: DealsView;
  /** A pipeline id, or null for every pipeline. */
  pipeline: string | null;
  /** A stage id, or null for every stage. */
  stage: string | null;
  /** "me", "none" or a member id; null for anyone. */
  owner: string | null;
  /** A Type choice's label, lowercased ("renewal"); null for any. */
  type: string | null;
  show: DealsShow;
  q: string | null;
}

type Search = Readonly<Record<string, string | readonly string[] | undefined>>;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function one(sp: Search, key: string): string | null {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s.trim() ? s.trim() : null;
}

export function parseDealsFilters(sp: Search): DealsFilters {
  const show = one(sp, "show");
  const owner = one(sp, "owner");
  const pipeline = one(sp, "pipeline");
  const type = one(sp, "type");
  const stage = one(sp, "stage");
  return {
    view: one(sp, "view") === "board" ? "board" : "list",
    pipeline: pipeline && ID.test(pipeline) ? pipeline : null,
    stage: stage && ID.test(stage) ? stage : null,
    owner: owner && (owner === "me" || owner === "none" || ID.test(owner)) ? owner : null,
    type: type ? type.toLowerCase().slice(0, 80) : null,
    show: show === "won" || show === "lost" || show === "all" ? show : "open",
    q: one(sp, "q")?.slice(0, 100) ?? null,
  };
}

// ---- Type --------------------------------------------------------------------------

export const DEAL_TYPE_FIELD = "Type";

/** The ready-made choices, in the tag palette. */
export const DEAL_TYPES: readonly { label: string; color: ChoiceColor }[] = [
  { label: "New", color: "blue" },
  { label: "Renewal", color: "yellow" },
  { label: "Partnership", color: "purple" },
  { label: "Grant", color: "green" },
];

/** The pipeline's Type field: a single select named "Type", if it has one. */
export function dealTypeField(fields: readonly FieldDef[]): FieldDef | null {
  return (
    fields.find((f) => f.type === "SELECT" && f.name.trim().toLowerCase() === "type") ?? null
  );
}

export interface DealType {
  id: string;
  label: string;
  color: ChoiceColor;
}

/** A deal's type from its custom values, or null when it has none. */
export function dealTypeOf(field: FieldDef | null, custom: unknown): DealType | null {
  if (!field || !custom || typeof custom !== "object") return null;
  const value = (custom as Record<string, unknown>)[field.id];
  if (typeof value !== "string") return null;
  const choice = field.options.choices?.find((c) => c.id === value);
  return choice ? { id: choice.id, label: choice.label, color: choice.color } : null;
}

/** The choices to offer: the field's own, or the ready-made ones before it exists. */
export function dealTypeChoices(field: FieldDef | null): { label: string; color: ChoiceColor }[] {
  const own = field?.options.choices ?? [];
  return own.length ? own.map((c) => ({ label: c.label, color: c.color })) : [...DEAL_TYPES];
}

// ---- Ambient buttons ---------------------------------------------------------------

const DAY = 86_400_000;

export interface DealForAmbient {
  closed: boolean;
  nextStep: string | null;
  nextStepAt: Date | null;
  stageEnteredAt: Date;
  stageName: string;
  /** The stage's limit in days, if it has one. */
  stuckAfterDays: number | null;
  /** The next open stage on, if there is one (never a closing stage: those ask why). */
  nextStage: { id: string; name: string } | null;
}

export type DealAmbientKind = "add-step" | "follow-up" | "push" | "next-stage";

export interface DealAmbient {
  /** Why the buttons are there, beside them on the same line. */
  why: string;
  actions: { kind: DealAmbientKind; label: string; tone: "solid" | "outline" }[];
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Whole days from `then` to `now` (by calendar day, UTC). */
export function daysBetween(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / DAY);
}

/**
 * What a deal row asks of you, if anything: at most two buttons and the
 * reason. A late next step comes first (Follow up, Push), then a missing
 * one (Add a next step), then a deal sitting past its stage's limit (Next
 * stage). Closed deals ask nothing.
 */
export function dealAmbient(d: DealForAmbient, now: Date = new Date()): DealAmbient | null {
  if (d.closed) return null;
  const step = d.nextStep?.trim();
  if (step && d.nextStepAt) {
    const late = daysBetween(d.nextStepAt, now);
    if (late > 0) {
      return {
        why: late === 1 ? "Next step a day late" : `Next step ${late} days late`,
        actions: [
          { kind: "follow-up", label: "Follow up", tone: "solid" },
          { kind: "push", label: "Push", tone: "outline" },
        ],
      };
    }
  }
  if (!step) {
    return { why: "No next step", actions: [{ kind: "add-step", label: "Add a next step", tone: "outline" }] };
  }
  if (d.stuckAfterDays && d.nextStage) {
    const days = daysBetween(d.stageEnteredAt, now);
    if (days > d.stuckAfterDays) {
      return {
        why: `${days} days in ${d.stageName}`,
        actions: [{ kind: "next-stage", label: "Next stage", tone: "solid" }],
      };
    }
  }
  return null;
}

/** The open stage after this one in the pipeline's order, or null. */
export function nextOpenStage<S extends { id: string; kind: string }>(
  stages: readonly S[],
  stageId: string,
): S | null {
  const at = stages.findIndex((s) => s.id === stageId);
  if (at < 0) return null;
  const next = stages[at + 1];
  return next && next.kind === "OPEN" ? next : null;
}

/** A next step as it reads under the name: "Send the deck, Nov 7", or "No next step". */
export function nextStepLine(step: string | null, at: Date | null): string {
  const text = step?.trim();
  if (!text) return "No next step";
  if (!at) return text;
  const day = at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${text}, ${day}`;
}

// ---- Groups ------------------------------------------------------------------------

export interface StageLike {
  id: string;
  name: string;
  kind: "OPEN" | "WON" | "LOST";
  pipelineId: string;
  pipelineName: string;
}

export interface StageGroup<R> {
  stage: StageLike;
  rows: R[];
  count: number;
  sumCents: number;
}

/** Rows by stage, in the stages' order; empty stages left out. */
export function groupByStage<R extends { stageId: string; amountCents: number | null }>(
  stages: readonly StageLike[],
  rows: readonly R[],
): StageGroup<R>[] {
  const by = new Map<string, R[]>();
  for (const r of rows) {
    const list = by.get(r.stageId);
    if (list) list.push(r);
    else by.set(r.stageId, [r]);
  }
  return stages
    .map((stage) => {
      const list = by.get(stage.id) ?? [];
      return {
        stage,
        rows: list,
        count: list.length,
        sumCents: list.reduce((n, r) => n + (r.amountCents ?? 0), 0),
      };
    })
    .filter((g) => g.count > 0);
}

/** A stage's dot: open stages step through the chart colours, Won is green, Lost red. */
export function stageTone(kind: "OPEN" | "WON" | "LOST", openIndex: number): string {
  if (kind === "WON") return "var(--chart-3)";
  if (kind === "LOST") return "var(--destructive)";
  const open = [
    "var(--muted-foreground)",
    "var(--chart-1)",
    "var(--chart-4)",
    "var(--tag-plum)",
    "var(--tag-teal)",
    "var(--chart-5)",
  ];
  return open[openIndex % open.length]!;
}
