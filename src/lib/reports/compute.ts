import type { ChoiceColor } from "@/lib/databases/fields";

import {
  CREATED,
  choiceFields,
  widgetTitle,
  type ReportField,
  type ReportWidget,
  type SourceSummary,
} from "./catalog";

/**
 * What each saved-report widget shows, worked out from its source's rows.
 * Pure: the report page computes with it on the server, and a snapshot is
 * just these payloads frozen. Dates are org-local yyyy-mm-dd; a row's date
 * is its date field, or the day it was added (CREATED).
 */

export interface ReportRow {
  id: string;
  /** The primary field as text. */
  title: string;
  values: Record<string, unknown>;
  /** ISO instants. */
  createdAt: string;
  updatedAt: string;
  href: string | null;
}

export interface LoadedSource extends SourceSummary {
  records: ReportRow[];
  /** A member field's user ids, named. */
  members: Record<string, string>;
  /** More rows than a report reads (the newest are kept). */
  truncated: boolean;
}

export interface Span {
  from: string | null;
  to: string | null;
  label: string;
}

export interface ComputeContext {
  span: Span;
  tz: string;
  /** Today, org-local. */
  today: string;
}

export type ValueFormat = "money" | "number";

export interface NumberPayload {
  value: number;
  previous: number | null;
  deltaPct: number | null;
  /** By week across the span, oldest first (at most 12). */
  spark: number[];
  format: ValueFormat;
  unit: string;
  /** "last quarter", "the same point last year", "the period before". */
  previousLabel: string | null;
}

export interface OverTimePayload {
  bucket: "week" | "month";
  /** Only the newest points fit; the total is theirs. */
  clipped?: boolean;
  points: { key: string; label: string; value: number; previous: number | null }[];
  total: number;
  previousTotal: number | null;
  previousLabel: string | null;
  format: ValueFormat;
}

export interface BreakdownPayload {
  rows: { id: string; label: string; color: ChoiceColor | null; value: number; share: number }[];
  total: number;
  format: ValueFormat;
  /** A multi-select: shares are of rows and can add up past 100%. */
  multi?: boolean;
}

export interface PipelinePayload {
  stages: {
    id: string;
    label: string;
    color: ChoiceColor | null;
    count: number;
    reached: number;
  }[];
  /** Rows at a choice that isn't a step (Rejected, Paid directly). */
  off: { label: string; count: number }[];
  /** Rows with no stage set. */
  unset: number;
  total: number;
}

export interface TopValuesPayload {
  rows: { id: string; title: string; value: number; href: string | null }[];
  format: ValueFormat;
}

export interface GoalPayload {
  value: number;
  target: number | null;
  by: string | null;
  pct: number | null;
  /** What it takes a week from today to reach the target by `by`. */
  perWeek: number | null;
  format: ValueFormat;
}

export interface ComparePayload {
  rows: {
    label: string;
    now: number;
    before: number;
    deltaPct: number | null;
    format: ValueFormat;
  }[];
  /** False when the span has no span before it (All time). */
  hasBefore: boolean;
  beforeLabel: string;
}

export interface CalendarPayload {
  /** Mondays first; each week's 7 days. */
  weeks: { date: string; count: number }[][];
  max: number;
  total: number;
  busiestWeekday: string | null;
}

export interface OverduePayload {
  overdue: {
    id: string;
    title: string;
    href: string | null;
    owner: string | null;
    ownerId: string | null;
    date: string;
    daysLate: number;
  }[];
  stale: {
    id: string;
    title: string;
    href: string | null;
    owner: string | null;
    ownerId: string | null;
    days: number;
  }[];
  /** The rows are tasks: Nudge and Push back work on them. */
  tasks: boolean;
  overdueCount: number;
  staleCount: number;
  staleDays: number;
  hasDate: boolean;
}

export interface TablePayload {
  /** `personal`: an email or phone column, which a view shared outside the organization hides. */
  columns: { id: string; name: string; numeric: boolean; personal?: boolean }[];
  rows: { id: string; href: string | null; cells: string[] }[];
  total: number;
  filterLabel: string | null;
}

export interface SpreadPayload {
  bins: { label: string; count: number }[];
  count: number;
  median: number | null;
  average: number | null;
  max: number | null;
  /** The share of the total the largest tenth of rows hold. */
  topShare: number | null;
  format: ValueFormat;
}

export interface HealthPayload {
  rows: number;
  duplicates: { title: string; count: number }[];
  empty: { field: string; pct: number }[];
  /** Rows nobody has changed in a year. */
  untouched: number;
}

export interface FormResultsPayload {
  responses: number;
  questions: {
    id: string;
    label: string;
    answered: number;
    options: { label: string; color: ChoiceColor | null; count: number; share: number }[];
  }[];
}

export interface JourneyPayload {
  steps: { label: string; count: number }[];
}

export interface ReachPayload {
  rows: { label: string; came: number; signedUp: number }[];
  attendees: number;
}

export interface WhenPayload {
  /** weekday 0 = Monday. */
  cells: {
    weekday: number;
    slot: "morning" | "afternoon" | "evening";
    events: number;
    average: number;
  }[];
  best: {
    weekday: number;
    slot: "morning" | "afternoon" | "evening";
    events: number;
    average: number;
  } | null;
}

export interface RegularsPayload {
  rows: { id: string; name: string; checkIns: number; lastDate: string }[];
}

export interface StoppedPayload {
  rows: { id: string; name: string; sessions: number; lastDate: string | null }[];
  total: number;
  /** Their addresses, for Invite them back (never kept in a copy). */
  emails: string[];
}

export interface InsightLine {
  text: string;
  widgetId: string | null;
  tone: "info" | "good" | "warn";
  /** The figure in the sentence to set in bold ("9 tasks", "$4,750"). */
  bold?: string | null;
  /** Which way it moved, for the line's arrow. */
  direction?: "up" | "down" | null;
  /** The widget it comes from, for its link ("Amount by category"). */
  label?: string | null;
  /** A next step this line suggests ("What I'd do next"). */
  next?: string | null;
}

export interface InsightsPayload {
  /** The one sentence on top; when absent, the first line is it. */
  lead?: string | null;
  lines: InsightLine[];
  /** "What I'd do next"; when absent, the first line's suggestion. */
  next?: string | null;
  /** Claude wrote them (an older reading kept on the report), not the built-in reading. */
  byClaude: boolean;
  at: string | null;
}

export type WidgetPayload =
  | { type: "number"; data: NumberPayload }
  | { type: "over-time"; data: OverTimePayload }
  | { type: "breakdown"; data: BreakdownPayload }
  | { type: "pipeline"; data: PipelinePayload }
  | { type: "top-values"; data: TopValuesPayload }
  | { type: "goal"; data: GoalPayload }
  | { type: "compare"; data: ComparePayload }
  | { type: "calendar"; data: CalendarPayload }
  | { type: "overdue"; data: OverduePayload }
  | { type: "table"; data: TablePayload }
  | { type: "spread"; data: SpreadPayload }
  | { type: "health"; data: HealthPayload }
  | { type: "form-results"; data: FormResultsPayload }
  | { type: "insights"; data: InsightsPayload }
  | { type: "journey"; data: JourneyPayload }
  | { type: "reach"; data: ReachPayload }
  | { type: "when"; data: WhenPayload }
  | { type: "regulars"; data: RegularsPayload }
  | { type: "stopped"; data: StoppedPayload };

// ---- Dates -------------------------------------------------------------------

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
export function plusDays(date: string, n: number): string {
  return fromUtc(toUtc(date) + n * DAY_MS);
}
export function daysFrom(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}
/** The org-local day of an instant. */
export function localDay(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
  return parts;
}
function monday(date: string): string {
  const dow = (new Date(toUtc(date)).getUTCDay() + 6) % 7;
  return plusDays(date, -dow);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function lastDayOfMonth(year: number, month: number): string {
  return fromUtc(Date.UTC(year, month, 0));
}

/**
 * The period just before `span`: the calendar year, quarter or month before
 * one ("last year", "last quarter", "last month"), otherwise as many days
 * just before it ("the period before"); null for All time. When the span
 * runs past `today` (this quarter, this year), only as many days of the
 * period before count as have gone by in this one, so the third week of a
 * quarter is set against the third week of the last ("the same point last
 * quarter"), not the whole of it.
 */
export function previousSpan(span: Span, today?: string): Span | null {
  const full = wholePreviousSpan(span);
  if (!full || !today || !span.from || !span.to || span.to <= today || today < span.from) {
    return full;
  }
  const to = plusDays(full.from!, daysFrom(span.from, today));
  const label = /^last /.test(full.label) ? `the same point ${full.label}` : full.label;
  return { from: full.from, to: to < full.to! ? to : full.to, label };
}

function wholePreviousSpan(span: Span): Span | null {
  if (!span.from || !span.to) return null;
  const [y, m, d] = span.from.split("-").map(Number);
  if (d === 1) {
    if (m === 1 && span.to === `${y}-12-31`) {
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: "last year" };
    }
    const quarterEnd = m + 2 <= 12 ? lastDayOfMonth(y, m + 2) : null;
    if ((m - 1) % 3 === 0 && span.to === quarterEnd) {
      const pm = m - 3 < 1 ? m + 9 : m - 3;
      const py = m - 3 < 1 ? y - 1 : y;
      const from = `${py}-${String(pm).padStart(2, "0")}-01`;
      return { from, to: lastDayOfMonth(py, pm + 2), label: "last quarter" };
    }
    if (span.to === lastDayOfMonth(y, m)) {
      const pm = m === 1 ? 12 : m - 1;
      const py = m === 1 ? y - 1 : y;
      return {
        from: `${py}-${String(pm).padStart(2, "0")}-01`,
        to: lastDayOfMonth(py, pm),
        label: "last month",
      };
    }
  }
  const days = daysFrom(span.from, span.to) + 1;
  const to = plusDays(span.from, -1);
  const from = plusDays(span.from, -days);
  return { from, to, label: "the period before" };
}

/**
 * The period before, or null when it can't be measured: a database bigger
 * than a report reads keeps only its newest rows, so a period older than the
 * oldest row read would look empty and every number would seem to soar.
 */
function comparable(s: LoadedSource, prev: Span | null, ctx: ComputeContext): Span | null {
  if (!prev || !s.truncated || s.records.length === 0) return prev;
  const oldest = localDay(s.records[0].createdAt, ctx.tz);
  return prev.from && oldest > prev.from ? null : prev;
}

function inSpan(date: string | null, span: Span): boolean {
  if (!date) return false;
  return (!span.from || date >= span.from) && (!span.to || date <= span.to);
}

// ---- Reading rows --------------------------------------------------------------

function field(source: LoadedSource, id: string | null | undefined): ReportField | undefined {
  return id ? source.fields.find((f) => f.id === id) : undefined;
}

function rowDate(row: ReportRow, dateId: string | undefined, tz: string): string | null {
  if (!dateId || dateId === CREATED) return localDay(row.createdAt, tz);
  const v = row.values[dateId];
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function num(row: ReportRow, id: string): number | null {
  const v = row.values[id];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function formatOf(f: ReportField | undefined): ValueFormat {
  return f?.type === "CURRENCY" ? "money" : "number";
}

function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function pct(now: number, before: number | null): number | null {
  if (before === null || before === 0) return null;
  return round(((now - before) / Math.abs(before)) * 100, 1);
}

function aggregate(
  rows: readonly ReportRow[],
  valueId: string | null | undefined,
  agg: string | undefined,
): number {
  if (!valueId || agg === "count" || !agg) return rows.length;
  const values = rows.map((r) => num(r, valueId)).filter((v): v is number => v !== null);
  const sum = values.reduce((a, b) => a + b, 0);
  if (agg === "avg") return values.length ? round(sum / values.length) : 0;
  return round(sum);
}

/** Text a cell shows, for titles, tables and duplicates. */
export function cellText(
  source: Pick<LoadedSource, "members">,
  f: ReportField,
  value: unknown,
): string {
  if (value === undefined || value === null || value === "") return "";
  switch (f.type) {
    case "SELECT":
      return f.choices?.find((c) => c.id === value)?.label ?? "";
    case "MULTI_SELECT":
      return Array.isArray(value)
        ? value
            .map((id) => f.choices?.find((c) => c.id === id)?.label)
            .filter(Boolean)
            .join(", ")
        : "";
    case "MEMBER":
      return typeof value === "string" ? (source.members[value] ?? "Former member") : "";
    case "CHECKBOX":
      return value === true ? "Yes" : "";
    case "DATE":
      return typeof value === "string" ? shortDay(value) : "";
    case "CURRENCY":
      return typeof value === "number" ? money(value) : "";
    case "NUMBER":
      return typeof value === "number" ? value.toLocaleString("en-US") : "";
    default:
      return String(value);
  }
}

export function money(n: number): string {
  const whole = Math.abs(n) >= 1000 || Number.isInteger(n);
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: whole ? 0 : 2,
  });
}

export function formatValue(n: number, format: ValueFormat): string {
  return format === "money" ? money(n) : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

// ---- Widgets -------------------------------------------------------------------

function computeNumber(w: ReportWidget, s: LoadedSource, ctx: ComputeContext): NumberPayload {
  const c = w.config;
  const f = field(s, c.field);
  const agg = f ? (c.agg ?? "sum") : "count";
  const dated = s.records.map((r) => ({ r, d: rowDate(r, c.date, ctx.tz) }));
  const now = dated.filter((x) => inSpan(x.d, ctx.span)).map((x) => x.r);
  const prevSpan = comparable(s, previousSpan(ctx.span, ctx.today), ctx);
  const before = prevSpan
    ? aggregate(
        dated.filter((x) => inSpan(x.d, prevSpan)).map((x) => x.r),
        f?.id,
        agg,
      )
    : null;
  const value = aggregate(now, f?.id, agg);
  // The spark: the span's last twelve weeks (or every week of a shorter one).
  const end = ctx.span.to && ctx.span.to < ctx.today ? ctx.span.to : ctx.today;
  const weeks: number[] = [];
  for (let i = 11; i >= 0; i--) {
    const start = plusDays(monday(end), -7 * i);
    if (ctx.span.from && plusDays(start, 6) < ctx.span.from) continue;
    const span = { from: start, to: plusDays(start, 6), label: "" };
    weeks.push(
      aggregate(
        dated.filter((x) => inSpan(x.d, span)).map((x) => x.r),
        f?.id,
        agg,
      ),
    );
  }
  return {
    value,
    previous: before,
    deltaPct: pct(value, before),
    spark: weeks,
    format: agg === "count" ? "number" : formatOf(f),
    unit: agg === "count" ? s.name.toLowerCase() : (f?.name ?? "").toLowerCase(),
    previousLabel: prevSpan?.label ?? null,
  };
}

/** Points an Over time chart draws at most. */
const MAX_POINTS = 60;

/** The first of the month `n` months after the month starting `first`. */
function addMonths(first: string, n: number): string {
  const [y, m] = first.split("-").map(Number);
  return fromUtc(Date.UTC(y, m - 1 + n, 1));
}

function nextMonth(first: string): string {
  const [y, m] = first.split("-").map(Number);
  return fromUtc(Date.UTC(y, m, 1));
}

function bucketKey(date: string, bucket: "week" | "month"): string {
  return bucket === "month" ? `${date.slice(0, 7)}-01` : monday(date);
}

function computeOverTime(w: ReportWidget, s: LoadedSource, ctx: ComputeContext): OverTimePayload {
  const c = w.config;
  const bucket = c.bucket ?? "week";
  const f = field(s, c.field);
  const agg = f ? (c.agg ?? "sum") : "count";
  const dated = s.records
    .map((r) => ({ r, d: rowDate(r, c.date, ctx.tz) }))
    .filter((x): x is { r: ReportRow; d: string } => x.d !== null);
  const inNow = dated.filter((x) => inSpan(x.d, ctx.span));
  // The first and last bucket: the span's, or the data's for All time.
  const sorted = inNow.map((x) => x.d).sort();
  const first = ctx.span.from ?? sorted[0] ?? ctx.today;
  // Through today, or the last dated row when rows run later (due dates).
  const latest = sorted[sorted.length - 1];
  const end = latest && latest > ctx.today ? latest : ctx.today;
  const lastDay = ctx.span.to && ctx.span.to < end ? ctx.span.to : end;
  let keys: string[] = [];
  let k = bucketKey(first, bucket);
  while (k <= lastDay) {
    keys.push(k);
    k = bucket === "month" ? nextMonth(k) : plusDays(k, 7);
  }
  // At most 60 points: the newest, and the total is theirs, so the chart adds up.
  const clipped = keys.length > MAX_POINTS;
  if (clipped) keys = keys.slice(-MAX_POINTS);
  const shown = new Set(keys);
  const byKey = new Map<string, ReportRow[]>();
  for (const x of inNow) {
    const key = bucketKey(x.d, bucket);
    byKey.set(key, [...(byKey.get(key) ?? []), x.r]);
  }
  const prev = comparable(s, previousSpan(ctx.span, ctx.today), ctx);
  const shift = prev && ctx.span.from ? daysFrom(prev.from!, ctx.span.from) : 0;
  const months =
    prev && ctx.span.from
      ? (Number(ctx.span.from.slice(0, 4)) - Number(prev.from!.slice(0, 4))) * 12 +
        Number(ctx.span.from.slice(5, 7)) -
        Number(prev.from!.slice(5, 7))
      : 0;
  const prevRows = prev ? dated.filter((x) => inSpan(x.d, prev)) : [];
  const prevByKey = new Map<string, ReportRow[]>();
  for (const x of prevRows) {
    // Lined up with the bucket the same day falls in this span.
    const key =
      bucket === "month"
        ? addMonths(bucketKey(x.d, "month"), months)
        : bucketKey(plusDays(x.d, shift), bucket);
    prevByKey.set(key, [...(prevByKey.get(key) ?? []), x.r]);
  }
  const points = keys.map((key) => ({
    key,
    label: bucket === "month" ? MONTHS[Number(key.slice(5, 7)) - 1] : shortDay(key),
    value: aggregate(byKey.get(key) ?? [], f?.id, agg),
    previous: prev ? aggregate(prevByKey.get(key) ?? [], f?.id, agg) : null,
  }));
  return {
    bucket,
    points,
    clipped,
    total: aggregate(
      inNow.filter((x) => shown.has(bucketKey(x.d, bucket))).map((x) => x.r),
      f?.id,
      agg,
    ),
    previousTotal: prev
      ? aggregate(
          prevRows.map((x) => x.r),
          f?.id,
          agg,
        )
      : null,
    previousLabel: prev?.label ?? null,
    format: agg === "count" ? "number" : formatOf(f),
  };
}

function ranged(s: LoadedSource, dateId: string | undefined, ctx: ComputeContext): ReportRow[] {
  return s.records.filter((r) => inSpan(rowDate(r, dateId, ctx.tz), ctx.span));
}

function computeBreakdown(w: ReportWidget, s: LoadedSource, ctx: ComputeContext): BreakdownPayload {
  const c = w.config;
  const g = field(s, c.group);
  const f = field(s, c.field);
  const agg = f ? (c.agg ?? "sum") : "count";
  const rows = ranged(s, c.date, ctx);
  const groups = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const v = g ? r.values[g.id] : undefined;
    const ids = Array.isArray(v) ? (v as string[]) : typeof v === "string" ? [v] : ["@none"];
    for (const id of ids) groups.set(id, [...(groups.get(id) ?? []), r]);
  }
  const out = [...groups.entries()].map(([id, rs]) => {
    const choice = g?.choices?.find((ch) => ch.id === id);
    const label =
      id === "@none"
        ? "Not set"
        : g?.type === "MEMBER"
          ? (s.members[id] ?? "Former member")
          : (choice?.label ?? "Other");
    return { id, label, color: choice?.color ?? null, value: aggregate(rs, f?.id, agg) };
  });
  out.sort((a, b) => b.value - a.value);
  // A row can carry several choices of a multi-select: each choice's share is
  // of the rows (they add up past 100%), and the total is the rows themselves.
  const multi = g?.type === "MULTI_SELECT" && agg === "count";
  const total = multi ? rows.length : out.reduce((a, b) => a + b.value, 0);
  return {
    rows: out
      .slice(0, 12)
      .map((r) => ({ ...r, share: total ? round((r.value / total) * 100, 1) : 0 })),
    total: round(total),
    format: agg === "count" ? "number" : formatOf(f),
    multi,
  };
}

function computePipeline(w: ReportWidget, s: LoadedSource): PipelinePayload {
  const g = field(s, w.config.group);
  const all = g?.choices ?? [];
  // The steps: the field's own stages when some choices aren't steps (Rejected), else every choice.
  const steps = g?.stages ? all.filter((c) => g.stages!.includes(c.id)) : all;
  const counts = new Map<string, number>();
  let unset = 0;
  for (const r of s.records) {
    const v = g ? r.values[g.id] : undefined;
    if (typeof v === "string" && all.some((c) => c.id === v))
      counts.set(v, (counts.get(v) ?? 0) + 1);
    else unset++;
  }
  // Reached: at this step or a later one.
  let later = 0;
  const reached = new Map<string, number>();
  for (const c of [...steps].reverse()) {
    later += counts.get(c.id) ?? 0;
    reached.set(c.id, later);
  }
  return {
    stages: steps.map((c) => ({
      id: c.id,
      label: c.label,
      color: c.color,
      count: counts.get(c.id) ?? 0,
      reached: reached.get(c.id) ?? 0,
    })),
    off: all
      .filter((c) => !steps.includes(c) && (counts.get(c.id) ?? 0) > 0)
      .map((c) => ({ label: c.label, count: counts.get(c.id) ?? 0 })),
    unset,
    total: s.records.length,
  };
}

function computeTop(w: ReportWidget, s: LoadedSource, ctx: ComputeContext): TopValuesPayload {
  const f = field(s, w.config.field);
  if (!f) return { rows: [], format: "number" };
  const rows = ranged(s, w.config.date, ctx)
    .map((r) => ({ id: r.id, title: r.title || "Untitled", value: num(r, f.id), href: r.href }))
    .filter(
      (r): r is { id: string; title: string; value: number; href: string | null } =>
        r.value !== null,
    )
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
  return { rows, format: formatOf(f) };
}

function computeGoal(w: ReportWidget, s: LoadedSource, ctx: ComputeContext): GoalPayload {
  const c = w.config;
  const f = field(s, c.field);
  const agg = f ? (c.agg ?? "sum") : "count";
  const value = aggregate(ranged(s, c.date, ctx), f?.id, agg);
  const target = c.target ?? null;
  const by = c.by ?? ctx.span.to;
  const left = by ? daysFrom(ctx.today, by) : null;
  const perWeek =
    target !== null && left !== null && left > 0 && value < target
      ? round(((target - value) / left) * 7)
      : null;
  return {
    value,
    target,
    by: by ?? null,
    pct: target ? Math.min(999, round((value / target) * 100, 0)) : null,
    perWeek,
    format: agg === "count" ? "number" : formatOf(f),
  };
}

function computeCompare(w: ReportWidget, s: LoadedSource, ctx: ComputeContext): ComparePayload {
  const prev = comparable(s, previousSpan(ctx.span, ctx.today), ctx);
  const dated = s.records.map((r) => ({ r, d: rowDate(r, w.config.date, ctx.tz) }));
  const now = dated.filter((x) => inSpan(x.d, ctx.span)).map((x) => x.r);
  const before = prev ? dated.filter((x) => inSpan(x.d, prev)).map((x) => x.r) : [];
  const rows: ComparePayload["rows"] = [
    {
      label: `${s.name} added`,
      now: now.length,
      before: before.length,
      deltaPct: pct(now.length, prev ? before.length : null),
      format: "number",
    },
  ];
  for (const f of s.fields
    .filter((x) => (x.type === "NUMBER" || x.type === "CURRENCY") && !x.id.startsWith("j."))
    .slice(0, 4)) {
    const a = aggregate(now, f.id, "sum");
    const b = aggregate(before, f.id, "sum");
    rows.push({
      label: `Total ${f.name.toLowerCase()}`,
      now: a,
      before: b,
      deltaPct: pct(a, prev ? b : null),
      format: formatOf(f),
    });
  }
  // The share of rows at a finished stage, when a status says which those are.
  const status = choiceFields(s).find((x) => (x.done?.length ?? 0) > 0);
  if (status) {
    const share = (rs: ReportRow[]) =>
      rs.length
        ? round(
            (rs.filter((r) => status.done!.includes(String(r.values[status.id]))).length /
              rs.length) *
              100,
            0,
          )
        : 0;
    rows.push({
      label: "Finished",
      now: share(now),
      before: share(before),
      deltaPct: null,
      format: "number",
    });
  }
  return { rows, hasBefore: prev !== null, beforeLabel: prev?.label ?? "" };
}

function computeCalendar(w: ReportWidget, s: LoadedSource, ctx: ComputeContext): CalendarPayload {
  const end = ctx.span.to && ctx.span.to < ctx.today ? ctx.span.to : ctx.today;
  // Up to a year, from the span's first Monday.
  const startDay =
    ctx.span.from && daysFrom(ctx.span.from, end) <= 364 ? ctx.span.from : plusDays(end, -364);
  const counts = new Map<string, number>();
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  for (const r of s.records) {
    const d = rowDate(r, w.config.date, ctx.tz);
    if (!d || d < startDay || d > end) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
    weekday[(new Date(toUtc(d)).getUTCDay() + 6) % 7]++;
  }
  const weeks: CalendarPayload["weeks"] = [];
  for (let m = monday(startDay); m <= end; m = plusDays(m, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = plusDays(m, i);
        return { date, count: counts.get(date) ?? 0 };
      }),
    );
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const best = weekday.indexOf(Math.max(...weekday));
  return {
    weeks,
    max: Math.max(0, ...counts.values()),
    total,
    busiestWeekday: total ? WEEKDAYS[best] : null,
  };
}

/** Finished rows: a done stage (Completed, Returned, Paid) or a checked Done box. */
function isDone(s: LoadedSource, r: ReportRow, statusId: string | undefined): boolean {
  const status = field(s, statusId) ?? choiceFields(s).find((f) => (f.done?.length ?? 0) > 0);
  if (status?.done?.includes(String(r.values[status.id]))) return true;
  return s.fields.some(
    (f) =>
      f.type === "CHECKBOX" &&
      /done|complete|returned|paid|closed/i.test(f.name) &&
      r.values[f.id] === true,
  );
}

function computeOverdue(w: ReportWidget, s: LoadedSource, ctx: ComputeContext): OverduePayload {
  const c = w.config;
  const staleDays = c.staleDays ?? 30;
  const due = field(s, c.date);
  const ownerId = (r: ReportRow) => {
    const id = c.owner ? r.values[c.owner] : undefined;
    return typeof id === "string" ? id : null;
  };
  const owner = (r: ReportRow) => {
    const id = ownerId(r);
    return id ? (s.members[id] ?? "Former member") : null;
  };
  const open = s.records.filter((r) => !isDone(s, r, c.group));
  const overdue = due
    ? open
        .map((r) => ({ r, d: r.values[due.id] }))
        .filter((x): x is { r: ReportRow; d: string } => typeof x.d === "string" && x.d < ctx.today)
        .map((x) => ({
          id: x.r.id,
          title: x.r.title || "Untitled",
          href: x.r.href,
          owner: owner(x.r),
          ownerId: ownerId(x.r),
          date: x.d,
          daysLate: daysFrom(x.d, ctx.today),
        }))
        .sort((a, b) => b.daysLate - a.daysLate)
    : [];
  const late = new Set(overdue.map((x) => x.id));
  const stale = open
    .filter((r) => !late.has(r.id))
    .map((r) => ({
      id: r.id,
      title: r.title || "Untitled",
      href: r.href,
      owner: owner(r),
      ownerId: ownerId(r),
      days: daysFrom(localDay(r.updatedAt, ctx.tz), ctx.today),
    }))
    .filter((x) => x.days >= staleDays)
    .sort((a, b) => b.days - a.days);
  return {
    overdue: overdue.slice(0, 8),
    stale: stale.slice(0, 8),
    overdueCount: overdue.length,
    staleCount: stale.length,
    staleDays,
    hasDate: Boolean(due),
    tasks: s.kind === "tasks",
  };
}

function computeTable(w: ReportWidget, s: LoadedSource): TablePayload {
  const c = w.config;
  const columns = (c.columns ?? [])
    .map((id) => field(s, id))
    .filter((f): f is ReportField => Boolean(f));
  const cols = columns.length ? columns : s.fields.slice(0, 4);
  const filterField = c.filter ? field(s, c.filter.field) : undefined;
  const rows = s.records.filter((r) => {
    if (!filterField || !c.filter) return true;
    const v = r.values[filterField.id];
    return Array.isArray(v) ? v.includes(c.filter.value) : v === c.filter.value;
  });
  const choice = filterField?.choices?.find((ch) => ch.id === c.filter?.value);
  return {
    columns: cols.map((f) => ({
      id: f.id,
      name: f.name,
      numeric: f.type === "NUMBER" || f.type === "CURRENCY",
      personal: f.type === "EMAIL" || f.type === "PHONE",
    })),
    rows: [...rows]
      .reverse()
      .slice(0, 25)
      .map((r) => ({
        id: r.id,
        href: r.href,
        cells: cols.map((f) => cellText(s, f, r.values[f.id])),
      })),
    total: rows.length,
    filterLabel: filterField && choice ? `${filterField.name} is ${choice.label}` : null,
  };
}

function niceStep(max: number): number {
  const raw = max / 6;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((st) => st >= raw) ?? pow * 10;
}

function computeSpread(w: ReportWidget, s: LoadedSource, ctx: ComputeContext): SpreadPayload {
  const f = field(s, w.config.field);
  const format = formatOf(f);
  const values = f
    ? ranged(s, w.config.date, ctx)
        .map((r) => num(r, f.id))
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b)
    : [];
  if (values.length === 0)
    return { bins: [], count: 0, median: null, average: null, max: null, topShare: null, format };
  const max = values[values.length - 1];
  const min = Math.min(0, values[0]);
  const step = niceStep(max - min);
  const bins: SpreadPayload["bins"] = [];
  for (let lo = Math.floor(min / step) * step; lo <= max && bins.length < 8; lo += step) {
    const hi = lo + step;
    const last = hi > max || bins.length === 7;
    bins.push({
      label: last
        ? `${formatValue(lo, format)}+`
        : `${formatValue(lo, format)} to ${formatValue(hi, format)}`,
      count: values.filter((v) => v >= lo && (last || v < hi)).length,
    });
    if (last) break;
  }
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  const sum = values.reduce((a, b) => a + b, 0);
  const top = values.slice(-Math.max(1, Math.ceil(values.length / 10))).reduce((a, b) => a + b, 0);
  return {
    bins,
    count: values.length,
    median: round(median),
    average: round(sum / values.length),
    max: round(max),
    topShare: sum > 0 ? round((top / sum) * 100, 0) : null,
    format,
  };
}

function computeHealth(s: LoadedSource, ctx: ComputeContext): HealthPayload {
  const titles = new Map<string, number>();
  for (const r of s.records) {
    const t = r.title.trim().toLowerCase();
    if (t) titles.set(t, (titles.get(t) ?? 0) + 1);
  }
  const display = new Map(s.records.map((r) => [r.title.trim().toLowerCase(), r.title.trim()]));
  const duplicates = [...titles.entries()]
    .filter(([, n]) => n > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t, count]) => ({ title: display.get(t) ?? t, count }));
  const empty = s.fields
    .map((f) => {
      const blank = s.records.filter((r) => {
        const v = r.values[f.id];
        return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      }).length;
      return {
        field: f.name,
        pct: s.records.length ? round((blank / s.records.length) * 100, 0) : 0,
      };
    })
    .filter((x) => x.pct >= 20)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);
  const yearAgo = plusDays(ctx.today, -365);
  return {
    rows: s.records.length,
    duplicates,
    empty,
    untouched: s.records.filter((r) => localDay(r.updatedAt, ctx.tz) < yearAgo).length,
  };
}

function computeForm(s: LoadedSource, ctx: ComputeContext): FormResultsPayload {
  const rows = ranged(s, CREATED, ctx);
  return {
    responses: rows.length,
    questions: s.fields
      .filter((f) => f.type === "SELECT" || f.type === "MULTI_SELECT" || f.type === "CHECKBOX")
      .slice(0, 6)
      .map((f) => {
        const answered = rows.filter((r) => {
          const v = r.values[f.id];
          return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0);
        });
        const choices =
          f.type === "CHECKBOX"
            ? [{ id: "yes", label: "Yes", color: "green" as const }]
            : (f.choices ?? []);
        const options = choices.map((ch) => {
          const count = answered.filter((r) => {
            const v = r.values[f.id];
            return f.type === "CHECKBOX"
              ? v === true
              : Array.isArray(v)
                ? v.includes(ch.id)
                : v === ch.id;
          }).length;
          return {
            label: ch.label,
            color: ch.color,
            count,
            share: answered.length ? round((count / answered.length) * 100, 0) : 0,
          };
        });
        return { id: f.id, label: f.name, answered: answered.length, options };
      }),
  };
}

/** One widget's payload; null for the People and Events widgets (they read the built-in reports). */
export function computeWidget(
  w: ReportWidget,
  s: LoadedSource,
  ctx: ComputeContext,
): WidgetPayload | null {
  switch (w.type) {
    case "number":
      return { type: w.type, data: computeNumber(w, s, ctx) };
    case "over-time":
      return { type: w.type, data: computeOverTime(w, s, ctx) };
    case "breakdown":
      return { type: w.type, data: computeBreakdown(w, s, ctx) };
    case "pipeline":
      return { type: w.type, data: computePipeline(w, s) };
    case "top-values":
      return { type: w.type, data: computeTop(w, s, ctx) };
    case "goal":
      return { type: w.type, data: computeGoal(w, s, ctx) };
    case "compare":
      return { type: w.type, data: computeCompare(w, s, ctx) };
    case "calendar":
      return { type: w.type, data: computeCalendar(w, s, ctx) };
    case "overdue":
      return { type: w.type, data: computeOverdue(w, s, ctx) };
    case "table":
      return { type: w.type, data: computeTable(w, s) };
    case "spread":
      return { type: w.type, data: computeSpread(w, s, ctx) };
    case "health":
      return { type: w.type, data: computeHealth(s, ctx) };
    case "form-results":
      return { type: w.type, data: computeForm(s, ctx) };
    default:
      return null;
  }
}

// ---- Insights ------------------------------------------------------------------

export interface ComputedWidget {
  widget: ReportWidget;
  title: string;
  payload: WidgetPayload | null;
}

/** "this quarter", "in the last 30 days", "in all". */
export function spanPhrase(span: Span): string {
  if (!span.from && !span.to) return "in all";
  if (/^last /i.test(span.label)) return `in the ${span.label.toLowerCase()}`;
  if (/^this /i.test(span.label)) return span.label.toLowerCase();
  return `from ${span.label}`;
}

function change(deltaPct: number | null, before: string | null): string {
  if (deltaPct === null) return "";
  const when = before ?? "the period before";
  if (Math.abs(deltaPct) < 1) return `, about the same as ${when}`;
  return `, ${deltaPct > 0 ? "up" : "down"} ${Math.abs(Math.round(deltaPct))}% on ${when}`;
}

/** "9 tasks", "1 expense", "4 rows in Sponsors": what a source's rows are called. */
export function rowsOf(source: Pick<SourceSummary, "kind" | "name">, n: number): string {
  if (source.kind === "tasks") return `${n} ${n === 1 ? "task" : "tasks"}`;
  if (source.kind === "expenses") return `${n} ${n === 1 ? "expense" : "expenses"}`;
  return `${n} ${n === 1 ? "row" : "rows"} in ${source.name}`;
}

/** "tasks", "expenses", "rows in Sponsors": the rows, uncounted. */
function rowsNoun(source: Pick<SourceSummary, "kind" | "name">): string {
  return rowsOf(source, 2).replace(/^2 /, "");
}

/** "amount", but "CBC sponsors" stays as written. */
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

function days(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"}`;
}

/**
 * The built-in reading: the plain facts each widget leads with, most
 * pressing first (overdue rows, a big swing), at most five lines. Claude
 * rewrites these, when the organization has connected it, from the same
 * payloads; without it, this is what Insights says.
 */
export function readInsights(
  widgets: readonly ComputedWidget[],
  span: Span,
  source: Pick<SourceSummary, "kind" | "name" | "fields"> = {
    kind: "custom",
    name: "this database",
    fields: [],
  },
): InsightLine[] {
  const fieldName = (id: string | null | undefined) =>
    id ? (source.fields.find((f) => f.id === id)?.name ?? null) : null;
  const warn: InsightLine[] = [];
  const lines: InsightLine[] = [];
  for (const { widget, title, payload } of widgets) {
    if (!payload) continue;
    const id = widget.id;
    switch (payload.type) {
      case "overdue": {
        const d = payload.data;
        if (d.overdueCount > 0) {
          const first = d.overdue[0];
          warn.push({
            tone: "warn",
            widgetId: id,
            label: title,
            bold: rowsOf(source, d.overdueCount),
            next: d.tasks
              ? `Nudge whoever owns the ${rowsOf(source, d.overdueCount)} past due, or push their dates back.`
              : `Follow up on the ${rowsOf(source, d.overdueCount)} past due, starting with ${first.title}.`,
            text: `${rowsOf(source, d.overdueCount)} ${d.overdueCount === 1 ? "is" : "are"} past due. The longest overdue is ${first.title}, ${days(first.daysLate)} late${first.owner ? ` (${first.owner})` : ""}.`,
          });
        } else if (d.staleCount > 0) {
          warn.push({
            tone: "warn",
            widgetId: id,
            label: title,
            bold: rowsOf(source, d.staleCount),
            next: `Update or close the ${rowsOf(source, d.staleCount)} nobody has changed in ${d.staleDays} days.`,
            text: `${rowsOf(source, d.staleCount)} ${d.staleCount === 1 ? "hasn't" : "haven't"} been changed in ${d.staleDays} days or more.`,
          });
        }
        break;
      }
      case "number": {
        const d = payload.data;
        lines.push({
          tone:
            d.deltaPct !== null && d.deltaPct < -15
              ? "warn"
              : d.deltaPct !== null && d.deltaPct > 15
                ? "good"
                : "info",
          widgetId: id,
          label: title,
          bold: formatValue(d.value, d.format),
          direction:
            d.deltaPct !== null && Math.abs(d.deltaPct) >= 1
              ? d.deltaPct > 0
                ? "up"
                : "down"
              : null,
          text: `${title}: ${formatValue(d.value, d.format)} ${spanPhrase(span)}${change(d.deltaPct, d.previousLabel)}.`,
        });
        break;
      }
      case "breakdown": {
        const d = payload.data;
        const top = d.rows[0];
        if (top && d.total > 0 && d.rows.length > 1) {
          lines.push({
            tone: "info",
            widgetId: id,
            label: title,
            bold: `${Math.round(top.share)}%`,
            text: d.multi
              ? `${top.label} is on ${Math.round(top.share)}% of ${rowsNoun(source)}.`
              : fieldName(widget.config.field)
                ? `${top.label} is ${Math.round(top.share)}% of the total ${lowerFirst(fieldName(widget.config.field)!)}.`
                : `${top.label} is ${Math.round(top.share)}% of ${rowsNoun(source)}.`,
          });
        }
        break;
      }
      case "pipeline": {
        const d = payload.data;
        const stuck = [...d.stages].sort((a, b) => b.count - a.count)[0];
        if (stuck && stuck.count > 0 && d.stages.length > 1) {
          lines.push({
            tone: "info",
            widgetId: id,
            label: title,
            bold: `${stuck.count} of ${d.total}`,
            text: `More sit at ${stuck.label} than at any other stage: ${stuck.count} of ${d.total}.`,
          });
        }
        break;
      }
      case "goal": {
        const d = payload.data;
        if (d.target && d.pct !== null) {
          lines.push({
            tone: d.pct >= 100 ? "good" : "info",
            widgetId: id,
            label: title,
            bold: d.pct >= 100 ? formatValue(d.value, d.format) : `${d.pct}%`,
            next:
              d.pct < 100 && d.perWeek
                ? `Aim for ${formatValue(d.perWeek, d.format)} a week to reach ${title.replace(/^Goal: /, "")}.`
                : null,
            text:
              d.pct >= 100
                ? `${title} reached: ${formatValue(d.value, d.format)} of ${formatValue(d.target, d.format)}.`
                : `${title} is at ${d.pct}%${d.perWeek ? `; ${formatValue(d.perWeek, d.format)} a week gets there` : ""}.`,
          });
        }
        break;
      }
      case "spread": {
        const d = payload.data;
        if (d.topShare !== null && d.topShare >= 40 && d.count >= 10) {
          lines.push({
            tone: "info",
            widgetId: id,
            label: title,
            bold: `${d.topShare}%`,
            text: `The biggest 10% of ${rowsNoun(source)} make up ${d.topShare}% of the total ${lowerFirst(fieldName(widget.config.field) ?? "amount")}, so the average (${formatValue(d.average ?? 0, d.format)}) runs high; the median is ${formatValue(d.median ?? 0, d.format)}.`,
          });
        }
        break;
      }
      case "health": {
        const d = payload.data;
        if (d.duplicates.length > 0) {
          warn.push({
            tone: "warn",
            widgetId: id,
            label: title,
            bold: `${d.duplicates.length} name${d.duplicates.length === 1 ? "" : "s"}`,
            next: `Merge the names that appear more than once, starting with ${d.duplicates[0].title}.`,
            text: `${d.duplicates.length} name${d.duplicates.length === 1 ? " appears" : "s appear"} more than once, starting with ${d.duplicates[0].title}.`,
          });
        }
        break;
      }
      case "calendar": {
        if (payload.data.busiestWeekday) {
          lines.push({
            tone: "info",
            widgetId: id,
            label: title,
            bold: `${payload.data.busiestWeekday}s`,
            text: `${payload.data.busiestWeekday}s are the busiest day.`,
          });
        }
        break;
      }
      default:
        break;
    }
  }
  return [...warn, ...lines].slice(0, 5);
}

/** Every widget of a report computed, Insights last (it reads the others). */
export function computeReport(
  widgets: readonly ReportWidget[],
  source: LoadedSource,
  ctx: ComputeContext,
  /** Claude's reading for this viewer and these dates, when there is one. */
  saved: { lines: InsightLine[]; lead?: string | null; next?: string | null; at: string } | null,
): ComputedWidget[] {
  const out: ComputedWidget[] = widgets.map((widget) => ({
    widget,
    title: widgetTitle(widget, source),
    payload: widget.type === "insights" ? null : computeWidget(widget, source, ctx),
  }));
  const lines = readInsights(out, ctx.span, source);
  for (const item of out) {
    if (item.widget.type !== "insights") continue;
    item.payload = {
      type: "insights",
      data: saved
        ? {
            lead: saved.lead ?? null,
            lines: saved.lines,
            next: saved.next ?? null,
            byClaude: true,
            at: saved.at,
          }
        : { lines, byClaude: false, at: null },
    };
  }
  return out;
}
