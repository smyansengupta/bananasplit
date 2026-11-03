import { addDaysToKey, isValidTimeZone, localDateKey, weekdayOfKey, zonedInstant } from "@/lib/tasks/dates";

/**
 * Booking pages (/book/{slug}): which times can be booked, built on the
 * hosts' availability (their busy hours in a typical week, the same cells
 * Find a time reads) and the meetings already on their calendar, and who
 * gets a booking when several hosts are free (round-robin: whoever has had
 * the fewest lately). A host who set their availability is bookable
 * whenever it doesn't say they're busy, within the availability grid's
 * hours (8 AM to 11 PM) on any day; a host who never set it, weekdays 9 to
 * 5. Pure.
 */

export interface BookingHost {
  userId: string;
  /** "d-h" cells, d 0 Monday .. 6 Sunday, h 0..23, in the organization's timezone. */
  busy: readonly string[];
  /** Meetings they're already in. */
  events: readonly { start: Date; end: Date }[];
  /** They set their availability (UserAvailability): their hours are its grid less their busy cells. */
  ownHours?: boolean;
}

/** The hours a host who set their availability can be booked: the availability grid's, every day. */
export const OWN_HOURS = { startHour: 8, endHour: 23, days: [1, 2, 3, 4, 5, 6, 7] } as const;

export interface SlotInput {
  now: Date;
  tz: string;
  durationMin: number;
  bufferMin: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  hosts: readonly BookingHost[];
  /** Bookable hours each open day (default 9 to 5) and days (ISO 1 Monday .. 7 Sunday). */
  startHour?: number;
  endHour?: number;
  days?: readonly number[];
  /** Minutes between possible starts (default 30). */
  step?: number;
}

export interface Slot {
  start: Date;
  end: Date;
  /** The hosts free then, in the page's order. */
  hostIds: string[];
}

export const BOOKING_HOURS = { startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] } as const;

function gridDay(key: string): number {
  // weekdayOfKey: 0 Sunday .. 6 Saturday; the availability grid is Monday first.
  return (weekdayOfKey(key) + 6) % 7;
}

function hostFree(
  host: BookingHost,
  key: string,
  start: Date,
  end: Date,
  bufferMs: number,
  tz: string,
  hours: { startHour: number; endHour: number; days: readonly number[] },
): boolean {
  const day = gridDay(key);
  const busy = new Set(host.busy);
  // Every hour the slot touches must be clear in their typical week.
  const firstHour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(start));
  const lastMinute = new Date(end.getTime() - 60_000);
  const lastHour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(lastMinute));
  // Inside their own bookable hours (their availability's, or the page's 9 to 5).
  const own = host.ownHours ? OWN_HOURS : hours;
  if (!(own.days as readonly number[]).includes(day + 1) || firstHour < own.startHour || lastHour >= own.endHour || lastHour < firstHour) return false;
  for (let h = firstHour; h <= lastHour; h++) if (busy.has(`${day}-${h}`)) return false;
  const s = start.getTime() - bufferMs;
  const e = end.getTime() + bufferMs;
  return !host.events.some((ev) => ev.start.getTime() < e && ev.end.getTime() > s);
}

/** Every bookable slot from now to maxDaysAhead, earliest first. */
export function bookingSlots(input: SlotInput): Slot[] {
  const tz = isValidTimeZone(input.tz) ? input.tz : "UTC";
  const fixed = {
    startHour: input.startHour ?? BOOKING_HOURS.startHour,
    endHour: input.endHour ?? BOOKING_HOURS.endHour,
    days: input.days ?? BOOKING_HOURS.days,
  };
  // The widest hours any host can be booked in; each host is then held to their own.
  const anyOwn = input.hosts.some((h) => h.ownHours);
  const startHour = anyOwn ? Math.min(fixed.startHour, OWN_HOURS.startHour) : fixed.startHour;
  const endHour = anyOwn ? Math.max(fixed.endHour, OWN_HOURS.endHour) : fixed.endHour;
  const days = anyOwn ? [...new Set([...fixed.days, ...OWN_HOURS.days])] : fixed.days;
  const step = Math.max(15, input.step ?? 30);
  const duration = Math.min(Math.max(input.durationMin, 10), 8 * 60) * 60_000;
  const buffer = Math.max(0, input.bufferMin) * 60_000;
  const earliest = input.now.getTime() + Math.max(0, input.minNoticeHours) * 3_600_000;
  const today = localDateKey(input.now, tz);
  const out: Slot[] = [];
  if (input.hosts.length === 0) return out;
  for (let i = 0; i <= Math.min(input.maxDaysAhead, 90); i++) {
    const key = addDaysToKey(today, i);
    const iso = gridDay(key) + 1;
    if (!days.includes(iso)) continue;
    const dayEnd = zonedInstant(key, endHour, tz).getTime();
    for (let t = zonedInstant(key, startHour, tz).getTime(); t + duration <= dayEnd; t += step * 60_000) {
      if (t < earliest) continue;
      const start = new Date(t);
      const end = new Date(t + duration);
      const hostIds = input.hosts.filter((h) => hostFree(h, key, start, end, buffer, tz, fixed)).map((h) => h.userId);
      if (hostIds.length) out.push({ start, end, hostIds });
    }
  }
  return out;
}

/** Round-robin: of the hosts free, whoever has had the fewest bookings lately (ties: page order). */
export function pickHost(free: readonly string[], recent: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestCount = Infinity;
  for (const id of free) {
    const n = recent.get(id) ?? 0;
    if (n < bestCount) {
      best = id;
      bestCount = n;
    }
  }
  return best;
}

/** Slots grouped by their day in the organization's timezone. */
export function slotsByDay(slots: readonly Slot[], tz: string): { key: string; slots: Slot[] }[] {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const out: { key: string; slots: Slot[] }[] = [];
  for (const s of slots) {
    const key = localDateKey(s.start, zone);
    const last = out[out.length - 1];
    if (last?.key === key) last.slots.push(s);
    else out.push({ key, slots: [s] });
  }
  return out;
}

export interface BookingQuestion {
  id: string;
  label: string;
  required: boolean;
}

export function readQuestions(raw: unknown): BookingQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((q): q is BookingQuestion => Boolean(q) && typeof q === "object" && typeof (q as BookingQuestion).label === "string")
    .slice(0, 10)
    .map((q, i) => ({
      id: typeof q.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(q.id) ? q.id : `q${i + 1}`,
      label: q.label.slice(0, 200),
      required: q.required === true,
    }));
}

/** A slug from a title: lowercase words joined by dashes, 4 to 48 characters. */
export function bookingSlug(title: string, suffix: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return `${base || "meet"}-${suffix}`.slice(0, 48);
}

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,47}$/;
