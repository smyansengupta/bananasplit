/**
 * Money and dates the way people type them in spreadsheets and bank
 * exports: "$1,234.56", "(12.00)", "- $25.00", "1.234,56", "9/5/2025",
 * "Sep 5, 2025", "2025-09-05T14:33:00", an Excel date number. Pure and
 * client-safe. Amounts come out as integer cents (the money.ts rule: never
 * a float), always positive, with the sign reported separately because a
 * sheet's sign convention is decided per sheet, not per cell.
 */

export type DateOrder = "MDY" | "DMY" | "YMD";

export interface ParsedAmount {
  /** Always positive. */
  cents: number;
  negative: boolean;
}

/** The most a single transaction can hold (Transaction.amountCents is a Postgres integer). */
export const MAX_IMPORT_CENTS = 2_000_000_000;

const CURRENCY = /US\$|CA\$|AU\$|A\$|NZ\$|HK\$|USD|CAD|EUR|GBP|AUD|INR|JPY|[$€£¥₹₩¢]/gi;

/** "12.345" → 1235: two decimals, half up, in integer arithmetic. */
function toCents(whole: string, fraction: string): number {
  const digits = (fraction + "000").slice(0, 3);
  let cents = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1;
  return cents;
}

/**
 * An amount as a person wrote it, or null when it isn't one. Negatives:
 * a leading minus (or − –), accounting parentheses, a trailing minus, or a
 * DR suffix. The decimal separator is the last of "," and "." when both
 * appear; a lone comma is decimal only before one or two final digits
 * ("12,50"), otherwise it groups thousands.
 */
export function parseAmount(raw: string): ParsedAmount | null {
  let s = raw.replace(/[\s  ']/g, "").replace(CURRENCY, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^[-−–]/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (/[-−–]$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  const suffix = /(CR|DR)$/i.exec(s);
  if (suffix) {
    if (suffix[1].toUpperCase() === "DR") negative = true;
    s = s.slice(0, -2);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const commas = s.split(",").length - 1;
    normalized = commas === 1 && /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else {
    const dots = s.split(".").length - 1;
    normalized = dots > 1 ? s.replace(/\./g, "") : s;
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(normalized);
  if (!match || (!match[1] && !match[2])) return null;
  const whole = match[1].replace(/^0+(?=\d)/, "") || "0";
  if (whole.length > 11) return null;
  return { cents: toCents(whole, match[2] ?? ""), negative };
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM-DD when y-m-d is a real day in a plausible year, else null. */
export function ymd(y: number, m: number, d: number): string | null {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * The year for a date written without one ("Sep 5", "9/5"): this year,
 * unless that lands more than two months after today, then last year. A
 * spreadsheet of past records is about the past.
 */
function withoutYear(m: number, d: number, today: string): string | null {
  const year = Number(today.slice(0, 4));
  const thisYear = ymd(year, m, d);
  if (!thisYear) return null;
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCMonth(limit.getUTCMonth() + 2);
  return new Date(`${thisYear}T00:00:00Z`) > limit ? ymd(year - 1, m, d) : thisYear;
}

/** Days from 1899-12-30: Excel's 1900 date system, with its leap-year bug. */
export function excelSerialToDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  const days = Math.floor(serial);
  const base = days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const date = new Date(base + days * 86_400_000);
  return ymd(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const WEEKDAY = /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i;

export interface DateOptions {
  order?: DateOrder;
  /** The club's local date (YYYY-MM-DD), for dates written without a year. */
  today: string;
  /** Read bare numbers between 20000 and 80000 as Excel date numbers (a CSV saved from Excel). */
  serials?: boolean;
}

/** A date as a person or a bank export wrote it, as YYYY-MM-DD, or null. */
export function parseDate(raw: string, { order = "MDY", today, serials = false }: DateOptions): string | null {
  const s = raw.trim().replace(WEEKDAY, "");
  if (!s) return null;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?=$|[T\s,])/.exec(s);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?=$|[T\s,])/.exec(s);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return order === "DMY" ? ymd(y, b, a) : ymd(y, a, b);
  }

  m = /^(\d{1,2})[/.](\d{1,2})$/.exec(s);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return order === "DMY" ? withoutYear(b, a, today) : withoutYear(a, b, today);
  }

  m = /^([a-z]{3,9})\.?[\s\-/]+(\d{1,2})(?:st|nd|rd|th)?(?:,?[\s\-/]+(\d{4}|\d{2}))?(?=$|[\s,T])/i.exec(s);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return m[3] ? ymd(Number(m[3]), month, Number(m[2])) : withoutYear(month, Number(m[2]), today);
  }

  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-/]+([a-z]{3,9})\.?(?:,?[\s\-/]+(\d{4}|\d{2}))?(?=$|[\s,T])/i.exec(s);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return m[3] ? ymd(Number(m[3]), month, Number(m[1])) : withoutYear(month, Number(m[1]), today);
  }

  if (serials && /^\d{5}(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 80000) return excelSerialToDate(n);
  }
  return null;
}

/**
 * Day-first or month-first, from the values themselves: a first number
 * over 12 means day-first, a second over 12 means month-first. Undecided
 * columns read month-first (a US club's default).
 */
export function guessDateOrder(values: readonly string[]): DateOrder {
  let dayFirst = 0;
  let monthFirst = 0;
  let yearFirst = 0;
  for (const v of values) {
    const m = /^\s*(\d{1,4})[-/.](\d{1,2})[-/.]/.exec(v);
    if (!m) continue;
    if (m[1].length === 4) yearFirst++;
    else if (Number(m[1]) > 12) dayFirst++;
    else if (Number(m[2]) > 12) monthFirst++;
  }
  if (dayFirst > monthFirst) return "DMY";
  if (yearFirst > 0 && monthFirst === 0 && dayFirst === 0) return "YMD";
  return "MDY";
}

/** True when most non-empty values parse as dates. */
export function looksLikeDates(values: readonly string[], today: string): boolean {
  const filled = values.filter((v) => v.trim());
  if (filled.length === 0) return false;
  const order = guessDateOrder(filled);
  const serials = filled.every((v) => /^\d{5}(?:\.\d+)?$/.test(v.trim()));
  const hits = filled.filter((v) => parseDate(v, { order, today, serials })).length;
  return hits / filled.length >= 0.6;
}

/** True when most non-empty values parse as amounts (and aren't just years or dates). */
export function looksLikeAmounts(values: readonly string[]): boolean {
  const filled = values.filter((v) => v.trim());
  if (filled.length === 0) return false;
  const hits = filled.filter((v) => !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(v.trim()) && parseAmount(v)).length;
  return hits / filled.length >= 0.6;
}
