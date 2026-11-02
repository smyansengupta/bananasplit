/**
 * Budget periods, the human way: an organization's money runs by calendar
 * year or by quarter, so these build sensible defaults instead of asking
 * for a label and two bare dates. Pure and client-safe.
 *
 * Dates are YYYY-MM-DD strings (what <input type="date"> uses) and the
 * stored @db.Date values are UTC midnight, so anything shown to people is
 * formatted in UTC: formatting a 2026-08-01 date in New York would print
 * July 31.
 */

export interface PeriodDraft {
  label: string;
  /** YYYY-MM-DD */
  startsOn: string;
  /** YYYY-MM-DD, inclusive. */
  endsOn: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The calendar quarter around `today`: "Q3 2026", Jul 1 to Sep 30. */
export function quarter(today: Date = new Date()): PeriodDraft {
  const y = today.getFullYear();
  const q = Math.floor(today.getMonth() / 3);
  const start = q * 3 + 1;
  const end = new Date(Date.UTC(y, start + 2, 0)).getUTCDate();
  return { label: `Q${q + 1} ${y}`, startsOn: ymd(y, start, 1), endsOn: ymd(y, start + 2, end) };
}

/** January to December. */
export function calendarYear(today: Date = new Date()): PeriodDraft {
  const y = today.getFullYear();
  return { label: String(y), startsOn: ymd(y, 1, 1), endsOn: ymd(y, 12, 31) };
}

export const PERIOD_PRESETS = [
  { id: "year", name: "This year", hint: "Jan 1 – Dec 31", make: calendarYear },
  { id: "quarter", name: "This quarter", hint: "Three months", make: quarter },
] as const;

export type PeriodPresetId = (typeof PERIOD_PRESETS)[number]["id"];

/** A stored @db.Date (UTC midnight) as YYYY-MM-DD. */
export function toDateValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** YYYY-MM-DD as the UTC-midnight Date Prisma stores for @db.Date. */
export function fromDateValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || toDateValue(d) !== value ? null : d;
}

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "Aug 1, 2026" for a stored @db.Date, never shifted a day by the viewer's timezone. */
export function formatPeriodDate(date: Date | string): string {
  return dayFmt.format(typeof date === "string" ? new Date(date) : date);
}

/** "Aug 1, 2026 – Jul 31, 2027". */
export function formatPeriodRange(start: Date | string, end: Date | string): string {
  return `${formatPeriodDate(start)} – ${formatPeriodDate(end)}`;
}

/** Whether `day` (any time that day, UTC) falls inside the period. */
export function periodCovers(period: { startsOn: Date; endsOn: Date }, day: Date): boolean {
  const t = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
  return t >= period.startsOn.getTime() && t <= period.endsOn.getTime();
}
