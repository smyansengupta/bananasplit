import type { CrmBookingPage } from "@/generated/prisma/client";
import { readHours, readOverrides } from "@/lib/booking/hours";
import { bookingSlots, readBusyDates, wallClock, type BookingHost, type Slot } from "@/lib/crm/outreach/booking";
import { isValidTimeZone } from "@/lib/tasks/dates";
import type { TxClient } from "@/server/db/context";

/**
 * Which times a meeting link can take, from the database (the pure engine
 * is src/lib/crm/outreach/booking.ts). A host is busy whenever
 * app.booking_host_busy says so (what they host or were asked to and didn't
 * decline, in every space they're in, and their whole Personal calendar
 * with its Google import), read fresh on every call, so a meeting added
 * after the page loaded still blocks the time when the guest books.
 */

export type BookingPageRow = Pick<
  CrmBookingPage,
  | "id"
  | "organizationId"
  | "hostIds"
  | "ownerUserId"
  | "durationMin"
  | "bufferMin"
  | "minNoticeHours"
  | "maxDaysAhead"
  | "hours"
  | "dateOverrides"
  | "timezone"
  | "maxPerDay"
>;

export function pageTimeZone(page: Pick<CrmBookingPage, "timezone" | "hours">, orgTz: string): string {
  // A link's own zone only applies to its own hours; the availability grid is in the organization's.
  if (page.hours && isValidTimeZone(page.timezone)) return page.timezone;
  return isValidTimeZone(orgTz) ? orgTz : "UTC";
}

export interface SlotOptions {
  durationMin: number;
  /** Rescheduling: this booking's own meeting doesn't block it, and it doesn't count toward the day's cap. */
  exceptEventId?: string | null;
  exceptBookingId?: string | null;
  /** Only this host (rescheduling keeps the host). */
  onlyHost?: string | null;
  /** A narrower window (the booking re-check). */
  from?: Date;
  to?: Date;
}

/** The hosts who are still members, in the page's order. */
export async function liveHosts(db: TxClient, page: BookingPageRow): Promise<string[]> {
  const rows = await db.membership.findMany({
    where: { organizationId: page.organizationId, userId: { in: page.hostIds } },
    select: { userId: true },
  });
  const ok = new Set(rows.map((r) => r.userId));
  return page.hostIds.filter((h) => ok.has(h));
}

/** Each host's busy times between from and to, from every space (times only). */
export async function hostBusy(
  db: TxClient,
  pageId: string,
  from: Date,
  to: Date,
  exceptEventId: string | null = null,
): Promise<Map<string, { start: Date; end: Date }[]>> {
  const rows = await db.$queryRaw<{ userId: string; startsAt: Date; endsAt: Date }[]>`
    SELECT "userId", ("startsAt" AT TIME ZONE 'UTC') AS "startsAt", ("endsAt" AT TIME ZONE 'UTC') AS "endsAt"
      FROM app.booking_host_busy(
             ${pageId},
             (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC'),
             (${to.toISOString()}::timestamptz AT TIME ZONE 'UTC'),
             ${exceptEventId}
           )`;
  const out = new Map<string, { start: Date; end: Date }[]>();
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push({ start: r.startsAt, end: r.endsAt });
    out.set(r.userId, list);
  }
  return out;
}

export async function slotsFor(
  db: TxClient,
  page: BookingPageRow,
  tz: string,
  now: Date,
  options: SlotOptions,
): Promise<Slot[]> {
  let hosts = await liveHosts(db, page);
  if (options.onlyHost) hosts = hosts.filter((h) => h === options.onlyHost);
  if (hosts.length === 0) return [];
  const hours = readHours(page.hours);
  const overrides = readOverrides(page.dateOverrides);
  const from = options.from ?? now;
  const to = options.to ?? new Date(now.getTime() + (page.maxDaysAhead + 2) * 86_400_000);
  const pad = page.bufferMin * 60_000;
  const busy = await hostBusy(db, page.id, new Date(from.getTime() - pad - 86_400_000), new Date(to.getTime() + pad), options.exceptEventId ?? null);
  // The availability grid (only for links without their own hours).
  const cells = hours
    ? []
    : await db.$queryRaw<{ userId: string; busy: string[]; dates: unknown }[]>`
        SELECT "userId", "busy", "dates" FROM app.crm_booking_busy(${page.id})`;
  // How many meetings each host already has on this link, per day (for the daily cap).
  const perDay = new Map<string, Map<string, number>>();
  if (page.maxPerDay) {
    const booked = await db.booking.findMany({
      where: {
        organizationId: page.organizationId,
        pageId: page.id,
        status: "BOOKED",
        startsAt: { gte: new Date(from.getTime() - 86_400_000), lt: to },
        ...(options.exceptBookingId ? { id: { not: options.exceptBookingId } } : {}),
      },
      select: { hostUserId: true, startsAt: true },
      take: 5000,
    });
    for (const b of booked) {
      const key = wallClock(b.startsAt, tz).key;
      const m = perDay.get(b.hostUserId) ?? new Map<string, number>();
      m.set(key, (m.get(key) ?? 0) + 1);
      perDay.set(b.hostUserId, m);
    }
  }
  const input: BookingHost[] = hosts.map((h) => {
    const c = cells.find((x) => x.userId === h);
    return {
      userId: h,
      busy: c?.busy ?? [],
      ownHours: (c?.busy.length ?? 0) > 0,
      dates: readBusyDates(c?.dates),
      hours,
      overrides,
      events: busy.get(h) ?? [],
      bookedPerDay: perDay.get(h),
    };
  });
  const slots = bookingSlots({
    now,
    tz,
    durationMin: options.durationMin,
    bufferMin: page.bufferMin,
    minNoticeHours: page.minNoticeHours,
    maxDaysAhead: page.maxDaysAhead,
    maxPerDay: page.maxPerDay,
    hosts: input,
  });
  return options.from || options.to
    ? slots.filter((s) => (!options.from || s.start >= options.from) && (!options.to || s.end <= options.to))
    : slots;
}
