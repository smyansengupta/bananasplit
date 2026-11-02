/**
 * The Reports date range: presets resolved to explicit org-local dates.
 *
 * Every preset becomes a canonical (from, to) pair of org-local calendar
 * dates (yyyy-mm-dd, inclusive) BEFORE any cached loader is called, so
 * "this quarter" and the same explicit dates share one cache key, and "all
 * time" is (null, null). The periods are an organization's (quarters and
 * years), not a school's terms.
 *
 *   ?range=quarter (default)  this calendar quarter in the org timezone
 *   ?range=year               this calendar year
 *   ?range=30d                the last 30 days, today included
 *   ?range=all                no bounds
 *   ?from=yyyy-mm-dd&to=yyyy-mm-dd   a custom range (wins over ?range)
 *
 * Malformed or reversed custom dates fall back to the default preset. The
 * term helpers below stay for the built-in attendance data, which records
 * a term on each check-in; no range is ever named after one.
 * Pure: no database, no request APIs.
 */

export type RangePreset = "quarter" | "year" | "30d" | "all" | "custom";

export interface ReportRange {
  preset: RangePreset;
  /** Org-local first day (inclusive), or null for no lower bound. */
  from: string | null;
  /** Org-local last day (inclusive), or null for no upper bound. */
  to: string | null;
  /** The term the range is exactly (fall-2026), when it is one. */
  term: string | null;
  /** e.g. "This quarter", "Last 30 days", "All time", "Sep 1 - Sep 30, 2026". */
  label: string;
  /** e.g. "Jul 1 - Dec 31, 2026"; null for all time. */
  span: string | null;
}

export interface RangeParams {
  range?: string | string[];
  from?: string | string[];
  to?: string | string[];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** The widest custom range accepted (a hand-edited URL cannot ask for more). */
const MAX_SPAN_DAYS = 366 * 20;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** True for a real calendar date written yyyy-mm-dd (years 1900-2999). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2999) return false;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function parts(date: string): [number, number, number] {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`not a yyyy-mm-dd date: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function fromUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** date + n calendar days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  return fromUtcDate(new Date(Date.UTC(y, m - 1, d + n)));
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = parts(a);
  const [yb, mb, db] = parts(b);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000);
}

/** Today's calendar date in `tz`. */
export function todayIn(tz: string, now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const byType = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/** The term of an org-local date: fall-YYYY from July 1, else spring-YYYY. */
export function termOfDate(date: string): string {
  const [y, m] = parts(date);
  return `${m >= 7 ? "fall" : "spring"}-${y}`;
}

const TERM = /^(fall|spring)-(\d{4})$/;

export function termBounds(term: string): { from: string; to: string } {
  const m = TERM.exec(term);
  if (!m) throw new RangeError(`not a term: ${term}`);
  const year = m[2];
  return m[1] === "fall"
    ? { from: `${year}-07-01`, to: `${year}-12-31` }
    : { from: `${year}-01-01`, to: `${year}-06-30` };
}

export function termLabel(term: string): string {
  const m = TERM.exec(term);
  if (!m) return term;
  return `${m[1] === "fall" ? "Fall" : "Spring"} ${m[2]}`;
}

/** The term a range covers exactly, or null. */
export function termOfRange(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const term = termOfDate(from);
  const bounds = termBounds(term);
  return bounds.from === from && bounds.to === to ? term : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Sep 1" or "Sep 1, 2026". */
export function formatDay(date: string, withYear = false): string {
  const [y, m, d] = parts(date);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
}

/** "Jul 1 - Dec 31, 2026" or "Dec 15, 2025 - Jan 14, 2026". */
export function formatSpan(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (from === to) return formatDay(from, true);
  return `${formatDay(from, !sameYear)} – ${formatDay(to, true)}`;
}

function build(preset: RangePreset, from: string | null, to: string | null): ReportRange {
  const term = termOfRange(from, to);
  const span = from && to ? formatSpan(from, to) : null;
  const label =
    preset === "all"
      ? "All time"
      : preset === "30d"
        ? "Last 30 days"
        : preset === "quarter"
          ? "This quarter"
          : preset === "year"
            ? "This year"
            : (span ?? "Custom range");
  return { preset, from, to, term, label, span };
}

/** The calendar quarter holding `date`. */
export function quarterBounds(date: string): { from: string; to: string } {
  const [y, m] = parts(date);
  const start = Math.floor((m - 1) / 3) * 3 + 1;
  const from = `${y}-${String(start).padStart(2, "0")}-01`;
  const next = start + 3 > 12 ? `${y + 1}-01-01` : `${y}-${String(start + 3).padStart(2, "0")}-01`;
  return { from, to: addDays(next, -1) };
}

/** This quarter's range in `tz`. */
export function currentQuarterRange(tz: string, now: Date = new Date()): ReportRange {
  const bounds = quarterBounds(todayIn(tz, now));
  return build("quarter", bounds.from, bounds.to);
}

/**
 * Resolves the page's search params to explicit dates. `now` is injectable
 * for tests; the page passes nothing.
 */
export function resolveReportRange(
  params: RangeParams,
  tz: string,
  now: Date = new Date(),
): ReportRange {
  const from = first(params.from);
  const to = first(params.to);
  if (isIsoDate(from) && isIsoDate(to) && from <= to && daysBetween(from, to) <= MAX_SPAN_DAYS) {
    return build("custom", from, to);
  }
  const preset = first(params.range);
  const today = todayIn(tz, now);
  if (preset === "all") return build("all", null, null);
  if (preset === "30d") return build("30d", addDays(today, -29), today);
  if (preset === "year")
    return build("year", `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`);
  return currentQuarterRange(tz, now);
}

/** The search params that select `range` again (for links that keep it). */
export function rangeQuery(
  range: Pick<ReportRange, "preset" | "from" | "to">,
): Record<string, string> {
  if (range.preset === "custom" && range.from && range.to)
    return { from: range.from, to: range.to };
  if (range.preset === "all") return { range: "all" };
  if (range.preset === "30d") return { range: "30d" };
  if (range.preset === "year") return { range: "year" };
  return {};
}
