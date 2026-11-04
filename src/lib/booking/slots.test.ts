import { describe, expect, it } from "vitest";

import { timesByDay } from "@/lib/crm/outreach/booking-calendar";
import { bookingSlots, pickHost, wallClock, type BookingHost } from "@/lib/crm/outreach/booking";
import { zonedInstant } from "@/lib/tasks/dates";

import { readHours, type WeeklyHours } from "./hours";

/**
 * The booking audit's slot cases (docs/features/booking.md, "Audit"): a
 * link's own hours, time zones and DST, notice and how far ahead, buffers,
 * one-off dates, the daily cap, round-robin and a host with no free time.
 */

const NY = "America/New_York";
const none: WeeklyHours = { "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [] };
const every = (r: [number, number]): WeeklyHours => ({ "1": [r], "2": [r], "3": [r], "4": [r], "5": [r], "6": [r], "7": [r] });

function host(userId: string, hours: WeeklyHours, extra: Partial<BookingHost> = {}): BookingHost {
  return { userId, busy: [], events: [], hours, ...extra };
}

const base = { tz: NY, durationMin: 30, bufferMin: 0, minNoticeHours: 0, maxDaysAhead: 6 };

describe("booking slots from a link's hours", () => {
  it("offers only the ranges filled in, in the link's zone", () => {
    // Monday 2026-11-09, 6 AM in New York.
    const now = zonedInstant("2026-11-09", 6, NY);
    const slots = bookingSlots({ ...base, now, maxDaysAhead: 0, hosts: [host("a", { ...none, "1": [[540, 720]] })] });
    expect(slots.map((s) => wallClock(s.start, NY).min / 60)).toEqual([9, 9.5, 10, 10.5, 11, 11.5]);
    expect(slots.every((s) => s.hostIds.join() === "a")).toBe(true);
  });

  it("keeps the wall-clock hours across the fall DST change (guests see the right instants)", () => {
    // US clocks fall back on Sunday 2026-11-01.
    const now = zonedInstant("2026-10-30", 0, NY);
    const slots = bookingSlots({ ...base, now, maxDaysAhead: 4, hosts: [host("a", every([540, 570]))] });
    expect(slots.map((s) => wallClock(s.start, NY))).toEqual(
      ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"].map((key) => ({ key, min: 540 })),
    );
    // 9 AM is 13:00 UTC before the change and 14:00 UTC after it.
    expect(slots[0]!.start.toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(slots[3]!.start.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("keeps the wall-clock hours across the spring DST change, and offers no time that doesn't exist", () => {
    // US clocks spring forward at 2 AM on Sunday 2027-03-14.
    const now = zonedInstant("2027-03-13", 0, NY);
    const slots = bookingSlots({ ...base, now, maxDaysAhead: 1, hosts: [host("a", every([60, 240]))] });
    const sunday = slots.filter((s) => wallClock(s.start, NY).key === "2027-03-14").map((s) => wallClock(s.start, NY).min);
    // 1:00, 1:30, then 3:00 and 3:30: 2:00 to 2:59 never happens that day.
    expect(sunday).toEqual([60, 90, 180, 210]);
    for (const s of slots) expect(s.end.getTime() - s.start.getTime()).toBe(30 * 60_000);
  });

  it("shows a guest in another zone the same instants on their own days", () => {
    const now = zonedInstant("2026-11-09", 0, NY);
    const slots = bookingSlots({ ...base, now, maxDaysAhead: 0, hosts: [host("a", { ...none, "1": [[1260, 1320]] })] });
    // 9 PM Monday in New York is Tuesday morning in Tokyo.
    const tokyo = timesByDay(slots.map((s) => s.start.toISOString()), "Asia/Tokyo");
    expect(tokyo.map((d) => d.key)).toEqual(["2026-11-10"]);
    expect(tokyo[0]!.slots).toEqual(slots.map((s) => s.start.toISOString()));
  });

  it("holds minimum notice and how far ahead", () => {
    const now = zonedInstant("2026-11-09", 9, NY);
    const slots = bookingSlots({ ...base, now, minNoticeHours: 2, maxDaysAhead: 3, hosts: [host("a", every([540, 1020]))] });
    expect(slots[0]!.start.getTime()).toBeGreaterThanOrEqual(now.getTime() + 2 * 3_600_000);
    const last = slots[slots.length - 1]!;
    expect(wallClock(last.start, NY).key).toBe("2026-11-12");
  });

  it("keeps the buffer clear around meetings already on the calendar", () => {
    const now = zonedInstant("2026-11-09", 0, NY);
    const meeting = { start: zonedInstant("2026-11-09", 10, NY), end: zonedInstant("2026-11-09", 10, NY, 30) };
    const slots = bookingSlots({
      ...base,
      now,
      bufferMin: 15,
      maxDaysAhead: 0,
      hosts: [host("a", { ...none, "1": [[540, 720]] }, { events: [meeting] })],
    });
    const mins = slots.map((s) => wallClock(s.start, NY).min);
    // 9:30 ends at 10:00 (no gap), 10:00 overlaps, 10:30 starts with no gap; 9:00 and 11:00 are fine.
    expect(mins).toEqual([540, 660, 690]);
  });

  it("never overlaps a meeting, even partly", () => {
    const now = zonedInstant("2026-11-09", 0, NY);
    const meeting = { start: zonedInstant("2026-11-09", 9, NY, 45), end: zonedInstant("2026-11-09", 10, NY, 15) };
    const slots = bookingSlots({ ...base, now, maxDaysAhead: 0, hosts: [host("a", { ...none, "1": [[540, 720]] }, { events: [meeting] })] });
    for (const s of slots) expect(s.start < meeting.end && s.end > meeting.start).toBe(false);
  });

  it("takes one-off dates: a day off, and other hours that day", () => {
    const now = zonedInstant("2026-11-09", 0, NY);
    const slots = bookingSlots({
      ...base,
      now,
      maxDaysAhead: 2,
      hosts: [
        host("a", every([540, 600]), {
          overrides: [
            { date: "2026-11-10", ranges: [] },
            { date: "2026-11-11", ranges: [[780, 840]] },
          ],
        }),
      ],
    });
    const byDay = (key: string) => slots.filter((s) => wallClock(s.start, NY).key === key).map((s) => wallClock(s.start, NY).min);
    expect(byDay("2026-11-09")).toEqual([540, 570]);
    expect(byDay("2026-11-10")).toEqual([]);
    expect(byDay("2026-11-11")).toEqual([780, 810]);
  });

  it("stops at the daily cap", () => {
    const now = zonedInstant("2026-11-09", 0, NY);
    const slots = bookingSlots({
      ...base,
      now,
      maxDaysAhead: 1,
      maxPerDay: 2,
      hosts: [host("a", every([540, 600]), { bookedPerDay: new Map([["2026-11-09", 2]]) })],
    });
    expect(slots.some((s) => wallClock(s.start, NY).key === "2026-11-09")).toBe(false);
    expect(slots.some((s) => wallClock(s.start, NY).key === "2026-11-10")).toBe(true);
  });

  it("ends a range at midnight without spilling into the next day", () => {
    const now = zonedInstant("2026-11-09", 0, NY);
    const slots = bookingSlots({ ...base, now, maxDaysAhead: 0, hosts: [host("a", { ...none, "1": [[1380, 1440]] })] });
    expect(slots.map((s) => wallClock(s.start, NY).min)).toEqual([1380, 1410]);
  });

  it("leaves out a host with no free time, and offers nothing when nobody has any", () => {
    const now = zonedInstant("2026-11-09", 0, NY);
    const slots = bookingSlots({ ...base, now, hosts: [host("busy", none), host("free", every([540, 600]))] });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.hostIds.join() === "free")).toBe(true);
    expect(bookingSlots({ ...base, now, hosts: [host("busy", none)] })).toEqual([]);
  });

  it("reads malformed hours safely", () => {
    expect(readHours({ "1": [[600, 540], [-5, 99999], "x"], "2": [[540, 600], [580, 700]] })).toMatchObject({
      "1": [[0, 1440]],
      "2": [[540, 700]],
      "3": [],
    });
    expect(readHours(null)).toBeNull();
  });
});

describe("round-robin", () => {
  it("gives the booking to whoever has had the fewest, then whoever waited longest", () => {
    expect(pickHost(["a", "b", "c"], new Map([["a", 2], ["b", 1], ["c", 1]]), new Map([["b", 200], ["c", 100]]))).toBe("c");
    expect(pickHost(["a", "b"], new Map(), new Map([["a", 5]]))).toBe("b");
    expect(pickHost([], new Map())).toBeNull();
  });

  it("spreads 30 bookings evenly over three free hosts", () => {
    const load = new Map<string, number>();
    const last = new Map<string, number>();
    for (let i = 0; i < 30; i++) {
      const h = pickHost(["a", "b", "c"], load, last)!;
      load.set(h, (load.get(h) ?? 0) + 1);
      last.set(h, i);
    }
    expect([load.get("a"), load.get("b"), load.get("c")]).toEqual([10, 10, 10]);
  });
});
