/**
 * A booking link's hours (docs/features/booking.md): "fill in the times
 * you're free". Each week as ranges of minutes per weekday, in the link's
 * zone, plus one-off dates that replace a day's ranges (none is a day off).
 * Pure, and safe on anything read from the database: malformed entries are
 * dropped, ranges are clamped to the day, sorted and merged.
 */

/** Minutes from local midnight, start inclusive, end exclusive (end may be 1440). */
export type MinuteRange = readonly [number, number];

/** ISO weekday "1" Monday .. "7" Sunday to its ranges. */
export type WeeklyHours = Readonly<Record<IsoDay, readonly MinuteRange[]>>;

export type IsoDay = "1" | "2" | "3" | "4" | "5" | "6" | "7";

export const ISO_DAYS: readonly IsoDay[] = ["1", "2", "3", "4", "5", "6", "7"];

export const DAY_NAMES: Record<IsoDay, string> = {
  "1": "Monday",
  "2": "Tuesday",
  "3": "Wednesday",
  "4": "Thursday",
  "5": "Friday",
  "6": "Saturday",
  "7": "Sunday",
};

export interface DateOverride {
  /** YYYY-MM-DD in the link's zone. */
  date: string;
  /** Empty: not free that day. Otherwise these replace the week's ranges that day. */
  ranges: readonly MinuteRange[];
}

/** Weekdays 9 to 5: where a new personal link starts. */
export const DEFAULT_HOURS: WeeklyHours = {
  "1": [[540, 1020]],
  "2": [[540, 1020]],
  "3": [[540, 1020]],
  "4": [[540, 1020]],
  "5": [[540, 1020]],
  "6": [],
  "7": [],
};

/** The lengths a link may offer, in minutes. */
export const BOOKING_DURATIONS = [15, 20, 30, 45, 60, 90] as const;

/** The most ranges a day keeps, and the most one-off dates a link keeps. */
const MAX_RANGES = 8;
const MAX_OVERRIDES = 120;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Clamped, sorted and merged ranges; anything malformed is dropped. */
export function readRanges(raw: unknown): MinuteRange[] {
  if (!Array.isArray(raw)) return [];
  const ranges: [number, number][] = [];
  for (const r of raw) {
    if (!Array.isArray(r) || r.length !== 2) continue;
    const [a, b] = r as unknown[];
    if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    const s = Math.max(0, Math.min(1440, Math.round(a)));
    const e = Math.max(0, Math.min(1440, Math.round(b)));
    if (e > s) ranges.push([s, e]);
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged.slice(0, MAX_RANGES);
}

/** A link's weekly hours, or null when it has none (it reads the hosts' availability instead). */
export function readHours(raw: unknown): WeeklyHours | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out = {} as Record<IsoDay, MinuteRange[]>;
  for (const d of ISO_DAYS) out[d] = readRanges(obj[d]);
  return out;
}

export function readOverrides(raw: unknown): DateOverride[] {
  if (!Array.isArray(raw)) return [];
  const byDate = new Map<string, DateOverride>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const { date, ranges } = r as Record<string, unknown>;
    if (typeof date !== "string" || !DATE_RE.test(date)) continue;
    byDate.set(date, { date, ranges: readRanges(ranges) });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_OVERRIDES);
}

/** The ranges free on `key` (a date in the link's zone) whose ISO weekday is `isoDay`. */
export function rangesOn(
  hours: WeeklyHours,
  overrides: readonly DateOverride[],
  key: string,
  isoDay: number,
): readonly MinuteRange[] {
  const o = overrides.find((x) => x.date === key);
  if (o) return o.ranges;
  return hours[String(isoDay) as IsoDay] ?? [];
}

/** Whether the week has any time free at all. */
export function hasAnyHours(hours: WeeklyHours, overrides: readonly DateOverride[] = []): boolean {
  return ISO_DAYS.some((d) => hours[d].length > 0) || overrides.some((o) => o.ranges.length > 0);
}

/** "9:00 AM" from minutes. */
export function minuteLabel(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  if (min === 1440) return "midnight";
  return mm === 0 ? `${h12} ${ampm}` : `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

/** "09:30" for an <input type="time">. */
export function minuteInput(min: number): string {
  if (min >= 1440) return "23:59";
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Minutes from "09:30" ("23:59" reads as the end of the day). */
export function parseMinuteInput(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  if (h === 23 && mm === 59) return 1440;
  return h * 60 + mm;
}

/**
 * A short line for the week: "Monday to Friday, 9 AM to 5 PM", or a day by
 * day list when the days differ ("Monday 9 AM to 12 PM, Tuesday ...").
 */
export function hoursSummary(hours: WeeklyHours): string {
  const line = (rs: readonly MinuteRange[]) =>
    rs.map(([s, e]) => `${minuteLabel(s)} to ${minuteLabel(e)}`).join(" and ");
  const open = ISO_DAYS.filter((d) => hours[d].length > 0);
  if (open.length === 0) return "No times set";
  const first = line(hours[open[0]!]);
  const same = open.every((d) => line(hours[d]) === first);
  const consecutive = open.every((d, i) => i === 0 || Number(d) === Number(open[i - 1]) + 1);
  if (same && consecutive && open.length > 1) {
    return `${DAY_NAMES[open[0]!]} to ${DAY_NAMES[open[open.length - 1]!]}, ${first}`;
  }
  if (same && open.length === 1) return `${DAY_NAMES[open[0]!]}s, ${first}`;
  return open.map((d) => `${DAY_NAMES[d]} ${line(hours[d])}`).join(", ");
}

/** The lengths a link offers, its default first, each one allowed, no repeats. */
export function offeredDurations(durationMin: number, durations: readonly number[] | null | undefined): number[] {
  const ok = (n: number) => (BOOKING_DURATIONS as readonly number[]).includes(n);
  const out = [ok(durationMin) ? durationMin : 30];
  for (const d of durations ?? []) if (ok(d) && !out.includes(d)) out.push(d);
  return out.slice(0, 4);
}
