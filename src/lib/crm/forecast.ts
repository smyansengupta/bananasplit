/**
 * Forecasting (docs/features/crm.md, module 8). Pure and client-safe.
 *
 * Three ways to say what's likely to come in, in money (where a pipeline
 * has amounts) and in people (a count of items: applicants likely to join,
 * speakers likely to confirm), for a quarter or a year:
 *
 * - weighted: each open item's amount (or 1) times its stage's likelihood;
 * - categories: what members marked Commit, Best case and Pipeline, rolled
 *   up (Best case includes Commit; Pipeline is everything open), plus what
 *   is already won; owners, admins and CRM managers can put their own call
 *   over the roll-up;
 * - trend: from the organization's own closed items (win rate, average
 *   amount, how many usually close in a period), once it has enough.
 *
 * Periods are calendar quarters and years only.
 */

export type PeriodKind = "quarter" | "year";

export interface Period {
  kind: PeriodKind;
  /** "2026-Q4" or "2026". */
  key: string;
  /** "Q4 2026" or "2026". */
  label: string;
  /** yyyy-mm-dd, inclusive. */
  start: string;
  end: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function periodOf(kind: PeriodKind, day: string): Period {
  const [y, m] = day.split("-").map(Number) as [number, number];
  if (kind === "year") return { kind, key: String(y), label: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
  const q = Math.floor((m - 1) / 3) + 1;
  const sm = (q - 1) * 3 + 1;
  const em = sm + 2;
  return { kind, key: `${y}-Q${q}`, label: `Q${q} ${y}`, start: `${y}-${pad(sm)}-01`, end: `${y}-${pad(em)}-${pad(lastDay(y, em))}` };
}

export function parsePeriodKey(key: string | null | undefined): Period | null {
  if (!key) return null;
  let m = /^(\d{4})-Q([1-4])$/.exec(key);
  if (m) return periodOf("quarter", `${m[1]}-${pad((Number(m[2]) - 1) * 3 + 1)}-01`);
  m = /^(\d{4})$/.exec(key);
  if (m) return periodOf("year", `${m[1]}-01-01`);
  return null;
}

/** The period n steps before or after this one. */
export function shiftPeriod(p: Period, n: number): Period {
  if (p.kind === "year") return periodOf("year", `${Number(p.key) + n}-01-01`);
  const [y, q] = p.key.split("-Q").map(Number) as [number, number];
  const idx = y * 4 + (q - 1) + n;
  const ny = Math.floor(idx / 4);
  const nq = (idx % 4) + 1;
  return periodOf("quarter", `${ny}-${pad((nq - 1) * 3 + 1)}-01`);
}

export function inPeriod(day: string | null | undefined, p: Period): boolean {
  return Boolean(day) && day! >= p.start && day! <= p.end;
}

export type Category = "PIPELINE" | "BEST_CASE" | "COMMIT" | "OMITTED";

export interface ForecastItem {
  id: string;
  amountCents: number | null;
  /** yyyy-mm-dd or null. */
  expectedOn: string | null;
  closedOn: string | null;
  stageKind: "OPEN" | "WON" | "LOST";
  /** 0 to 100, the stage's likelihood (null: no likelihood set). */
  probability: number | null;
  category: Category;
  ownerId: string | null;
}

export interface Figures {
  /** Money in cents (0 when the pipeline has no amounts). */
  amount: number;
  /** Items. */
  count: number;
}

const zero = (): Figures => ({ amount: 0, count: 0 });
const add = (f: Figures, amount: number, count: number) => {
  f.amount += amount;
  f.count += count;
};

/** The open items a period's forecast counts: expected in it, or (in the current period) with no date. */
export function openIn(items: readonly ForecastItem[], p: Period, current: boolean): ForecastItem[] {
  return items.filter(
    (i) => i.stageKind === "OPEN" && i.category !== "OMITTED" && (inPeriod(i.expectedOn, p) || (current && !i.expectedOn)),
  );
}

export function wonIn(items: readonly ForecastItem[], p: Period): ForecastItem[] {
  return items.filter((i) => i.stageKind === "WON" && inPeriod(i.closedOn, p));
}

export interface Forecast {
  period: Period;
  won: Figures;
  weighted: Figures;
  commit: Figures;
  bestCase: Figures;
  pipeline: Figures;
  /** Open items in the period with no expected date (counted only in the current period). */
  undated: number;
}

export function computeForecast(items: readonly ForecastItem[], p: Period, current: boolean): Forecast {
  const won = zero();
  for (const i of wonIn(items, p)) add(won, i.amountCents ?? 0, 1);
  const open = openIn(items, p, current);
  const weighted = zero();
  const commit = zero();
  const bestCase = zero();
  const pipeline = zero();
  for (const i of open) {
    const pr = (i.probability ?? 0) / 100;
    add(weighted, Math.round((i.amountCents ?? 0) * pr), pr);
    add(pipeline, i.amountCents ?? 0, 1);
    if (i.category === "COMMIT") add(commit, i.amountCents ?? 0, 1);
    if (i.category === "COMMIT" || i.category === "BEST_CASE") add(bestCase, i.amountCents ?? 0, 1);
  }
  weighted.count = Math.round(weighted.count * 10) / 10;
  return {
    period: p,
    won,
    weighted: { amount: weighted.amount + won.amount, count: Math.round((weighted.count + won.count) * 10) / 10 },
    commit: { amount: commit.amount + won.amount, count: commit.count + won.count },
    bestCase: { amount: bestCase.amount + won.amount, count: bestCase.count + won.count },
    pipeline: { amount: pipeline.amount + won.amount, count: pipeline.count + won.count },
    undated: open.filter((i) => !i.expectedOn).length,
  };
}

/** Closed items needed before the trend forecast shows. */
export const TREND_MIN_CLOSED = 20;

export interface Trend {
  enough: boolean;
  closed: number;
  /** Won / (won + lost), 0 to 1. */
  winRate: number;
  averageWonCents: number;
  averageDaysToClose: number;
  /** Won per quarter over the four quarters before (money, count). */
  runRate: Figures;
  /** What the trend expects for the period: what's won plus open items at the win rate, or the run rate when it's higher. */
  expected: Figures;
  basis: string;
}

/**
 * The trend forecast: the organization's own last four periods (win rate,
 * average amount, how much usually closes), applied to this period.
 */
export function computeTrend(items: readonly ForecastItem[], p: Period, current: boolean, history: readonly { createdOn: string; closedOn: string; won: boolean; amountCents: number | null }[]): Trend {
  // The four quarters before this period starts.
  const start = periodOf("quarter", p.start);
  const from = shiftPeriod(start, -4).start;
  const recent = history.filter((h) => h.closedOn >= from && h.closedOn < start.start);
  const won = recent.filter((h) => h.won);
  const closed = recent.length;
  const winRate = closed ? won.length / closed : 0;
  const averageWonCents = won.length ? Math.round(won.reduce((a, h) => a + (h.amountCents ?? 0), 0) / won.length) : 0;
  const averageDaysToClose = won.length
    ? Math.round(won.reduce((a, h) => a + (Date.parse(h.closedOn) - Date.parse(h.createdOn)) / 86_400_000, 0) / won.length)
    : 0;
  const runRate = { amount: Math.round(won.reduce((a, h) => a + (h.amountCents ?? 0), 0) / 4), count: Math.round((won.length / 4) * 10) / 10 };
  const already = zero();
  for (const i of wonIn(items, p)) add(already, i.amountCents ?? 0, 1);
  const open = openIn(items, p, current);
  const fromOpen = {
    amount: Math.round(open.reduce((a, i) => a + (i.amountCents ?? averageWonCents), 0) * winRate),
    count: Math.round(open.length * winRate * 10) / 10,
  };
  const byOpen = { amount: already.amount + fromOpen.amount, count: Math.round((already.count + fromOpen.count) * 10) / 10 };
  const scale = p.kind === "year" ? 4 : 1;
  const byRun = { amount: Math.max(already.amount, runRate.amount * scale), count: Math.max(already.count, runRate.count * scale) };
  const expected = { amount: Math.round((byOpen.amount + byRun.amount) / 2), count: Math.round(((byOpen.count + byRun.count) / 2) * 10) / 10 };
  return {
    enough: closed >= TREND_MIN_CLOSED,
    closed,
    winRate,
    averageWonCents,
    averageDaysToClose,
    runRate,
    expected,
    basis: closed
      ? `${Math.round(winRate * 100)}% of the ${closed} items closed in the four quarters before were won.`
      : "Nothing has closed in the last four quarters yet.",
  };
}

/** What a weekly snapshot keeps (CrmForecastSnapshot.data). */
export interface SnapshotData {
  kind: "snapshot";
  period: string;
  won: Figures;
  weighted: Figures;
  commit: Figures;
  bestCase: Figures;
  pipeline: Figures;
  trend: Figures | null;
  /** The call a manager put over the roll-up, if any. */
  call: Figures | null;
  /** Open items' categories, ids only, to say what changed between snapshots. */
  items: { id: string; c: Category; a: number | null; s: string }[];
}

/** A manager's own call over the roll-up (CrmForecastSnapshot.data with kind "call"). */
export interface CallData {
  kind: "call";
  period: string;
  amount: number;
  count: number;
  note: string | null;
  by: string;
}

export function readSnapshot(raw: unknown): SnapshotData | CallData | null {
  if (!raw || typeof raw !== "object") return null;
  const k = (raw as { kind?: string }).kind;
  if (k === "snapshot" || k === "call") return raw as SnapshotData | CallData;
  return null;
}

/** What changed between two snapshots: items added, gone, moved category or amount. */
export function snapshotChanges(
  before: SnapshotData,
  after: SnapshotData,
): { added: string[]; removed: string[]; category: { id: string; from: Category; to: Category }[]; amount: { id: string; from: number | null; to: number | null }[] } {
  const a = new Map(before.items.map((i) => [i.id, i]));
  const b = new Map(after.items.map((i) => [i.id, i]));
  const added = [...b.keys()].filter((id) => !a.has(id));
  const removed = [...a.keys()].filter((id) => !b.has(id));
  const category: { id: string; from: Category; to: Category }[] = [];
  const amount: { id: string; from: number | null; to: number | null }[] = [];
  for (const [id, x] of b) {
    const y = a.get(id);
    if (!y) continue;
    if (y.c !== x.c) category.push({ id, from: y.c, to: x.c });
    if (y.a !== x.a) amount.push({ id, from: y.a, to: x.a });
  }
  return { added, removed, category, amount };
}

// ---- Goals --------------------------------------------------------------------------

export const GOAL_METRICS = ["amount_won", "items_won", "people_reached", "replies", "meetings"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

export const GOAL_LABELS: Record<GoalMetric, string> = {
  amount_won: "Amount won",
  items_won: "Items won",
  people_reached: "People reached",
  replies: "Replies",
  meetings: "Meetings",
};

export interface Attainment {
  actual: number;
  target: number;
  /** 0 to 1+ (can pass 1). */
  share: number;
  /** Where it should be by now, at an even pace (0 to 1). */
  pace: number;
  onTrack: boolean;
}

export function attainment(actual: number, target: number, period: { start: string; end: string }, today: string): Attainment {
  const s = Date.parse(period.start);
  const e = Date.parse(period.end) + 86_400_000;
  const t = Math.min(e, Math.max(s, Date.parse(today) + 86_400_000));
  const pace = e > s ? (t - s) / (e - s) : 1;
  const share = target > 0 ? actual / target : 0;
  return { actual, target, share, pace, onTrack: share >= pace * 0.9 };
}
