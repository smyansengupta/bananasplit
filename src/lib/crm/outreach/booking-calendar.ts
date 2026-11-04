/**
 * The public booking page's month calendar (the Booking design): open
 * times grouped by day in the organization's timezone, and each month as a
 * grid of weeks starting Sunday. Pure.
 */

export interface DayTimes {
  /** YYYY-MM-DD in the page's timezone. */
  key: string;
  /** ISO instants, in order. */
  slots: string[];
}

/** Open times grouped by their day in `tz`. */
export function timesByDay(slots: readonly string[], tz: string): DayTimes[] {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out: DayTimes[] = [];
  for (const s of [...slots].sort()) {
    const key = fmt.format(new Date(s));
    const last = out[out.length - 1];
    if (last?.key === key) last.slots.push(s);
    else out.push({ key, slots: [s] });
  }
  return out;
}

/** "2026-11" of a day key. */
export function monthOf(key: string): string {
  return key.slice(0, 7);
}

/** The months from the first open day's to the last's, in order. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number) as [number, number];
  const [ly, lm] = last.split("-").map(Number) as [number, number];
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 24) break;
  }
  return out;
}

export interface MonthGrid {
  /** "November 2026" */
  label: string;
  /** Day keys, with null for the blanks before the 1st (weeks start Sunday). */
  cells: (string | null)[];
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A month ("2026-11") as a grid of day keys. */
export function monthGrid(month: string): MonthGrid {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first }, () => null);
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);
  return { label: `${MONTHS[m - 1]} ${y}`, cells };
}

/** "Friday, November 6" of a day key. */
export function longDay(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Fri Nov 6" of a day key. */
export function shortDay(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  const wd = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${wd} ${md}`;
}

/** "Eastern Time" for a timezone, falling back to its name. */
export function zoneName(tz: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longGeneric" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (part) return part;
  } catch {
    // An unknown zone: its name will do.
  }
  return tz.replace(/_/g, " ");
}

/** Up to two letters for an organization with no logo: "Northside Makers" is "NM". */
export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter((w) => /[A-Za-z0-9]/.test(w))
      .slice(0, 2)
      .map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0]!.toUpperCase())
      .join("") || "?"
  );
}
