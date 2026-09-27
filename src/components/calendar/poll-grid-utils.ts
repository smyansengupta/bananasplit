import type { PollAvailability } from "@/generated/prisma/enums";
import { zonedDateKey, zonedDateTimeLocal } from "@/lib/calendar/dates";

export interface PollSlotLite {
  id: string;
  startsAt: Date;
  endsAt: Date;
}

/**
 * One answer, keyed by an opaque respondent key (src/lib/polls/poll-view.ts):
 * the grid never sees user ids, and two guests with the same name stay two
 * respondents.
 */
export interface PollResponseLite {
  slotId: string;
  respondentKey: string;
  label?: string;
  isGuest?: boolean;
  availability: PollAvailability;
}

/** "YYYY-MM-DD" of `date` in `timeZone`. */
export function slotDayKey(date: Date, timeZone: string): string {
  return zonedDateKey(date, timeZone);
}

/** "HH:mm" (24h) of `date` in `timeZone`. */
export function slotTimeKey(date: Date, timeZone: string): string {
  return zonedDateTimeLocal(date, timeZone).slice(11, 16);
}

export interface PollGrid {
  /** Day keys, "YYYY-MM-DD", in `timeZone`, sorted. */
  days: string[];
  /** Times of day, "HH:mm", in `timeZone`, sorted. */
  times: string[];
  cellFor: (day: string, time: string) => PollSlotLite | undefined;
  /** Where a slot sits: its column (day index) and row (time index). */
  positionOf: (slotId: string) => GridPosition | undefined;
}

export interface GridPosition {
  day: number;
  time: number;
}

/**
 * The day x time-of-day matrix the response grids are drawn from, in
 * `timeZone` (the viewer's, or the poll's when they ask for it). The server
 * renders it in the poll's zone and the browser swaps in the viewer's, so
 * the first paint never depends on the server's own clock.
 */
export function buildPollGrid(slots: PollSlotLite[], timeZone: string): PollGrid {
  const byKey = new Map<string, PollSlotLite>();
  const daySet = new Set<string>();
  const timeSet = new Set<string>();
  const keyOf = new Map<string, [string, string]>();
  for (const slot of slots) {
    const day = slotDayKey(slot.startsAt, timeZone);
    const time = slotTimeKey(slot.startsAt, timeZone);
    daySet.add(day);
    timeSet.add(time);
    byKey.set(`${day}_${time}`, slot);
    keyOf.set(slot.id, [day, time]);
  }
  const days = [...daySet].sort();
  const times = [...timeSet].sort();
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const timeIndex = new Map(times.map((t, i) => [t, i]));
  return {
    days,
    times,
    cellFor: (day, time) => byKey.get(`${day}_${time}`),
    positionOf: (slotId) => {
      const key = keyOf.get(slotId);
      if (!key) return undefined;
      return { day: dayIndex.get(key[0])!, time: timeIndex.get(key[1])! };
    },
  };
}

/** Every distinct person who has answered at least one slot, for the results table. */
export function distinctRespondents(
  responses: PollResponseLite[],
): { key: string; name: string; isGuest: boolean }[] {
  const seen = new Map<string, { key: string; name: string; isGuest: boolean }>();
  for (const r of responses) {
    if (!seen.has(r.respondentKey)) {
      seen.set(r.respondentKey, {
        key: r.respondentKey,
        name: r.label ?? "Respondent",
        isGuest: Boolean(r.isGuest),
      });
    }
  }
  return [...seen.values()];
}

/** Who answered what for one slot. Counts drive the heatmap; names the details panel. */
export interface SlotSummary {
  yes: PollResponseLite[];
  ifNeeded: PollResponseLite[];
  no: PollResponseLite[];
  /** YES + IF_NEEDED: the number the heatmap shades by, as the ranking counts it. */
  available: number;
}

const EMPTY_SUMMARY: SlotSummary = { yes: [], ifNeeded: [], no: [], available: 0 };

export function summarizeSlots(responses: PollResponseLite[]): Map<string, SlotSummary> {
  const map = new Map<string, SlotSummary>();
  for (const r of responses) {
    let s = map.get(r.slotId);
    if (!s) {
      s = { yes: [], ifNeeded: [], no: [], available: 0 };
      map.set(r.slotId, s);
    }
    if (r.availability === "YES") s.yes.push(r);
    else if (r.availability === "IF_NEEDED") s.ifNeeded.push(r);
    else s.no.push(r);
    s.available = s.yes.length + s.ifNeeded.length;
  }
  return map;
}

export function summaryFor(map: Map<string, SlotSummary>, slotId: string): SlotSummary {
  return map.get(slotId) ?? EMPTY_SUMMARY;
}

export const HEAT_MIN_PERCENT = 18;
export const HEAT_MAX_PERCENT = 84;
/**
 * At or above this share of the hue the count switches to the hue's own ink
 * (dark mode only: on a light page the page's ink stays readable to the top).
 */
export const HEAT_INK_SWITCH_PERCENT = 66;
const HEAT_DEAD_BAND: [number, number] = [60, HEAT_INK_SWITCH_PERCENT];

/**
 * The heatmap's sequential scale: how much of the single availability hue a
 * cell carries (0 = no fill), from `available` of `total` respondents. One
 * hue mixed into the page surface, so it reads light-to-dark on a light page
 * and dark-to-bright on a dark one.
 *
 * The limits keep the count printed in each cell at 4.5:1 or better (measured
 * on the default and CBC themes, both modes): above 84% the page's ink fails
 * on a light page, and between 60% and 66% a dark page's midtone suits
 * neither ink, so a share landing there snaps to the nearer edge.
 */
export function heatPercent(available: number, total: number): number {
  if (available <= 0 || total <= 0) return 0;
  const share = Math.min(1, available / total);
  const percent = Math.round(HEAT_MIN_PERCENT + share * (HEAT_MAX_PERCENT - HEAT_MIN_PERCENT));
  const [low, high] = HEAT_DEAD_BAND;
  if (percent > low && percent < high) return percent - low < high - percent ? low : high;
  return percent;
}

/** The counts the legend shows a swatch for: every count up to 6 people, then 5 even steps. */
export function legendSteps(total: number): number[] {
  if (total <= 0) return [];
  if (total <= 6) return Array.from({ length: total + 1 }, (_, i) => i);
  const steps = new Set<number>([0]);
  for (let i = 1; i <= 4; i++) steps.add(Math.round((total * i) / 4));
  return [...steps].sort((a, b) => a - b);
}

/**
 * The value one stroke paints, decided by the cell it starts on (the
 * when2meet gesture): starting on a cell already marked with the brush
 * undoes it (marks it unavailable); anything else takes the brush.
 */
export function strokeValue(
  existing: PollAvailability | undefined,
  brush: PollAvailability,
): PollAvailability {
  return existing === brush && brush !== "NO" ? "NO" : brush;
}

/**
 * `base` with every slot in the rectangle between `from` and `to` (inclusive,
 * any corner order) set to `value`. Gaps in the grid (a time that doesn't
 * exist on a day) are skipped.
 */
export function paintRect(
  base: Record<string, PollAvailability>,
  grid: PollGrid,
  from: GridPosition,
  to: GridPosition,
  value: PollAvailability,
): Record<string, PollAvailability> {
  const next = { ...base };
  const [d0, d1] = from.day <= to.day ? [from.day, to.day] : [to.day, from.day];
  const [t0, t1] = from.time <= to.time ? [from.time, to.time] : [to.time, from.time];
  for (let d = d0; d <= d1; d++) {
    for (let t = t0; t <= t1; t++) {
      const slot = grid.cellFor(grid.days[d], grid.times[t]);
      if (slot) next[slot.id] = value;
    }
  }
  return next;
}

export interface RankedSlot {
  slot: PollSlotLite;
  score: number;
  respondentKeys: string[];
  /** Of `respondentKeys`, those who marked any slot in the window "if needed". */
  ifNeededKeys: string[];
  /** Every slot the window covers, first to last. */
  slotIds: string[];
  /** The end of the window: the start plus the meeting's length. */
  endsAt: Date;
}

/**
 * Ranks each possible contiguous window of `durationMinutes` by how many
 * distinct respondents are available (YES or IF_NEEDED) across every slot in
 * that window. Windows with a gap in the underlying slots are skipped.
 */
export function rankSlotsByAvailability(
  slots: PollSlotLite[],
  responses: PollResponseLite[],
  durationMinutes: number,
): RankedSlot[] {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const granularityMs = sorted[0].endsAt.getTime() - sorted[0].startsAt.getTime();
  const windowSlotCount = Math.max(1, Math.ceil((durationMinutes * 60_000) / granularityMs));

  const responsesBySlot = new Map<string, PollResponseLite[]>();
  for (const r of responses) {
    const list = responsesBySlot.get(r.slotId) ?? [];
    list.push(r);
    responsesBySlot.set(r.slotId, list);
  }

  const results: RankedSlot[] = [];
  for (let i = 0; i + windowSlotCount <= sorted.length; i++) {
    const window = sorted.slice(i, i + windowSlotCount);
    let contiguous = true;
    for (let j = 1; j < window.length; j++) {
      if (window[j].startsAt.getTime() !== window[j - 1].endsAt.getTime()) {
        contiguous = false;
        break;
      }
    }
    if (!contiguous) continue;

    let available: Set<string> | null = null;
    const ifNeeded = new Set<string>();
    for (const slot of window) {
      const slotResponses = responsesBySlot.get(slot.id) ?? [];
      const availableHere = new Set<string>();
      for (const r of slotResponses) {
        if (r.availability === "YES" || r.availability === "IF_NEEDED")
          availableHere.add(r.respondentKey);
        if (r.availability === "IF_NEEDED") ifNeeded.add(r.respondentKey);
      }
      available = available === null ? availableHere : intersect(available, availableHere);
    }

    const keys = [...(available ?? [])];
    results.push({
      slot: window[0],
      score: keys.length,
      respondentKeys: keys,
      ifNeededKeys: keys.filter((k) => ifNeeded.has(k)),
      slotIds: window.map((s) => s.id),
      endsAt: new Date(window[0].startsAt.getTime() + durationMinutes * 60_000),
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * The best `count` windows that don't overlap each other, best first. The
 * raw ranking puts 10:30, 10:45 and 11:00 side by side when one afternoon
 * suits everyone; a shortlist of distinct options is what people choose from.
 * Windows nobody can make are left out. Among equal scores the earlier stays
 * first (the ranking is a stable sort of chronological windows); YES beats
 * "if needed" as a tiebreak.
 */
export function pickDistinctWindows(ranked: RankedSlot[], count: number): RankedSlot[] {
  const ordered = [...ranked]
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.ifNeededKeys.length - b.ifNeededKeys.length);
  const picked: RankedSlot[] = [];
  for (const candidate of ordered) {
    if (picked.length >= count) break;
    const start = candidate.slot.startsAt.getTime();
    const end = candidate.endsAt.getTime();
    const overlaps = picked.some(
      (p) => start < p.endsAt.getTime() && p.slot.startsAt.getTime() < end,
    );
    if (!overlaps) picked.push(candidate);
  }
  return picked;
}

function intersect<T>(a: Set<T>, b: Set<T>): Set<T> {
  return new Set([...a].filter((x) => b.has(x)));
}
