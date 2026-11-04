/**
 * The CRM's ready-made reports (Deals, People and Outreach, in Databases >
 * Reports). Pure helpers the server and the tests share: which report an
 * old /crm/reports link means, which months a chart shows, and the
 * send-time grid.
 */

export type CrmReportOn = "deals" | "people" | "outreach";

/** /crm/reports, /crm/reports/deals/<pipeline>, /crm/reports/people, /crm/reports/outreach. */
export function parseReportPath(segments: readonly string[] | undefined): { on: CrmReportOn; pipelineId: string | null } {
  const [head, id] = segments ?? [];
  if (head === "people" || head === "outreach") return { on: head, pipelineId: null };
  return { on: "deals", pipelineId: head === "deals" && id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The months a by-month chart shows ("2026-06"): the range's months up to
 * today, at most `max` of them (the latest); all time is the last six.
 */
export function monthKeys(from: string | null, to: string | null, today: string, max = 12): string[] {
  const end = (to && to < today ? to : today).slice(0, 7);
  const out: string[] = [];
  let [y, m] = end.split("-").map(Number) as [number, number];
  const start = from ? from.slice(0, 7) : null;
  const limit = from ? max : 6;
  while (out.length < limit) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (start && key < start) break;
    out.unshift(key);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function monthLabel(key: string): string {
  return MONTHS[Number(key.slice(5, 7)) - 1] ?? key;
}

export const DAYPARTS = ["Morning", "Midday", "Afternoon", "Evening"] as const;
export type Daypart = (typeof DAYPARTS)[number];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** An hour (0 to 23, their time) as a part of the day. */
export function daypartOf(hour: number): Daypart {
  if (hour >= 6 && hour < 11) return "Morning";
  if (hour >= 11 && hour < 14) return "Midday";
  if (hour >= 14 && hour < 18) return "Afternoon";
  return "Evening";
}

export interface SendCell {
  /** 0 Sunday to 6 Saturday. */
  dow: number;
  hour: number;
  sent: number;
  replied: number;
}

export interface HeatGrid {
  rows: { part: Daypart; cells: { day: string; sent: number; rate: number | null }[] }[];
  best: { day: string; part: Daypart; rate: number; sent: number } | null;
  max: number;
}

/**
 * Reply rate by weekday and part of the day, Monday to Friday. A cell with
 * fewer than `min` sent has no rate (too few to read), and can't be best.
 */
export function heatGrid(cells: readonly SendCell[], min = 5): HeatGrid {
  const acc = new Map<string, { sent: number; replied: number }>();
  for (const c of cells) {
    if (c.dow < 1 || c.dow > 5) continue;
    const key = `${c.dow}:${daypartOf(c.hour)}`;
    const a = acc.get(key) ?? { sent: 0, replied: 0 };
    a.sent += c.sent;
    a.replied += c.replied;
    acc.set(key, a);
  }
  let best: HeatGrid["best"] = null;
  let max = 0;
  const rows = DAYPARTS.map((part) => ({
    part,
    cells: WEEKDAYS.map((day, i) => {
      const a = acc.get(`${i + 1}:${part}`) ?? { sent: 0, replied: 0 };
      const rate = a.sent >= min ? a.replied / a.sent : null;
      if (rate !== null) {
        max = Math.max(max, rate);
        if (!best || rate > best.rate) best = { day, part, rate, sent: a.sent };
      }
      return { day, sent: a.sent, rate };
    }),
  }));
  return { rows, best, max };
}
