import { calendarYear, schoolYear, semester, type PeriodDraft } from "@/lib/finance/periods";

/**
 * Which budget period each imported row lands in. Shared by the review (to
 * show it) and the import action (to do it, against fresh data): a row goes
 * into the period covering its date, preferring the active one; a date no
 * period covers gets a new one shaped like the club's others (school year,
 * semester or calendar year), created inactive. Pure and client-safe.
 */

export interface PeriodLike {
  id: string;
  label: string;
  /** YYYY-MM-DD */
  startsOn: string;
  /** YYYY-MM-DD, inclusive. */
  endsOn: string;
  isActive: boolean;
}

export type PeriodStyle = "school-year" | "semester" | "calendar-year";

const DAY_MS = 86_400_000;

/** The period covering `date`: the active one if it does, else the latest-starting one. */
export function coveringPeriod<P extends PeriodLike>(periods: readonly P[], date: string): P | null {
  const covering = periods.filter((p) => p.startsOn <= date && date <= p.endsOn);
  if (covering.length === 0) return null;
  return covering.find((p) => p.isActive) ?? covering.sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0];
}

/** How the club splits its money: by semester when its periods are short, by calendar year when they run Jan–Dec. */
export function periodStyle(periods: readonly PeriodLike[]): PeriodStyle {
  if (periods.length === 0) return "school-year";
  const days = (p: PeriodLike) => (Date.parse(p.endsOn) - Date.parse(p.startsOn)) / DAY_MS;
  if (periods.filter((p) => days(p) < 200).length > periods.length / 2) return "semester";
  if (periods.some((p) => p.startsOn.endsWith("-01-01") && p.endsOn.endsWith("-12-31"))) return "calendar-year";
  return "school-year";
}

/** The new period a date outside every period would go into. */
export function draftPeriodFor(date: string, style: PeriodStyle): PeriodDraft {
  const at = new Date(`${date}T12:00:00`);
  if (style === "semester") return semester(at);
  if (style === "calendar-year") return calendarYear(at);
  return schoolYear(at);
}

export type PeriodTarget = { existing: string } | { draft: PeriodDraft };

/**
 * Each date's period: an existing period's id, or the draft to create. Drafts
 * are shared by label, so a year of rows makes one period, not one per row.
 * A draft that would overlap an existing period is narrowed to the gap, so
 * new periods never overlap the club's own.
 */
export function planPeriods(
  periods: readonly PeriodLike[],
  dates: readonly string[],
): { targets: Map<string, PeriodTarget>; drafts: PeriodDraft[] } {
  const style = periodStyle(periods);
  const targets = new Map<string, PeriodTarget>();
  const drafts = new Map<string, PeriodDraft>();
  for (const date of new Set(dates)) {
    const existing = coveringPeriod(periods, date);
    if (existing) {
      targets.set(date, { existing: existing.id });
      continue;
    }
    const draft = fitDraft(draftPeriodFor(date, style), periods, date);
    const key = `${draft.startsOn}|${draft.endsOn}`;
    let shared = drafts.get(key);
    if (!shared) {
      // Two pieces of one school year around an existing period get distinct names.
      const taken = new Set([...periods.map((p) => p.label), ...[...drafts.values()].map((d) => d.label)]);
      let label = draft.label;
      for (let n = 2; taken.has(label); n++) label = `${draft.label} (${n})`;
      shared = { ...draft, label };
      drafts.set(key, shared);
    }
    targets.set(date, { draft: shared });
  }
  return { targets, drafts: [...drafts.values()] };
}

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Trims a draft so it doesn't overlap any existing period (it still covers `date`). */
function fitDraft(draft: PeriodDraft, periods: readonly PeriodLike[], date: string): PeriodDraft {
  let { startsOn, endsOn } = draft;
  for (const p of periods) {
    if (p.endsOn < startsOn || p.startsOn > endsOn) continue;
    if (p.endsOn < date) startsOn = shiftDay(p.endsOn, 1) > startsOn ? shiftDay(p.endsOn, 1) : startsOn;
    else if (p.startsOn > date) endsOn = shiftDay(p.startsOn, -1) < endsOn ? shiftDay(p.startsOn, -1) : endsOn;
  }
  return { ...draft, startsOn, endsOn };
}
