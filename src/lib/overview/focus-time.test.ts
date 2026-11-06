import { describe, expect, it } from "vitest";

import { EMPTY_AVAILABILITY, type Availability } from "@/lib/availability";

import { blockHours, focusWeek, spansOf } from "./focus-time";

// Sunday, Nov 1 2026.
const TODAY = "2026-11-01";

describe("focusWeek", () => {
  it("counts a whole free grid day as 15 hours, from 8 AM to 11 PM", () => {
    const week = focusWeek({
      todayKey: TODAY,
      nowHour: 0,
      availability: EMPTY_AVAILABILITY,
      events: [],
    });
    expect(week.days).toHaveLength(7);
    expect(week.days.map((d) => d.letter).join("")).toBe("SMTWTFS");
    expect(week.days[0]!.free).toBe(15);
    expect(week.best).toEqual({ key: TODAY, start: 8, end: 23 });
  });

  it("drops today's hours that have passed", () => {
    const week = focusWeek({
      todayKey: TODAY,
      nowHour: 14.25,
      availability: EMPTY_AVAILABILITY,
      events: [],
    });
    expect(week.days[0]!.free).toBe(8);
    // Tomorrow's whole day is longer than what's left of today.
    expect(week.best).toEqual({ key: "2026-11-02", start: 8, end: 23 });
  });

  it("takes out weekly blocks, date rules and events", () => {
    const availability: Availability = {
      v: 1,
      // Monday is day 0 in the grid: 9 and 10 AM blocked by hand.
      blocks: ["0-9", "0-10"],
      rules: [
        { kind: "never", scope: "hour", hour: 22 },
        { kind: "weekly", label: "Class", days: [0, 1, 2, 3, 4, 5, 6], start: 8, end: 9 },
        { kind: "date", label: "Trip", date: "2026-11-03", start: null, end: null },
      ],
    };
    const week = focusWeek({
      todayKey: TODAY,
      nowHour: 0,
      availability,
      events: [
        // Monday 2:30 to 3:30 PM takes the 2 and the 3 o'clock hours.
        { key: "2026-11-02", from: 14.5, to: 15.5 },
      ],
    });
    const monday = week.days[1]!;
    // 15 hours, less 8, 9, 10, 14, 15 and 22.
    expect(monday.free).toBe(9);
    // Tuesday is away all day.
    expect(week.days[2]!.free).toBe(0);
    // Sunday: 9 AM to 10 PM is the longest stretch, the earliest of equals.
    expect(week.best).toEqual({ key: TODAY, start: 9, end: 22 });
  });

  it("has no block when every hour is taken", () => {
    const availability: Availability = {
      v: 1,
      blocks: [],
      rules: [0, 1, 2, 3, 4, 5, 6].map((day) => ({ kind: "never", scope: "day", day }) as const),
    };
    const week = focusWeek({ todayKey: TODAY, nowHour: 0, availability, events: [] });
    expect(week.best).toBeNull();
    expect(week.days.every((d) => d.free === 0)).toBe(true);
  });
});

describe("blockHours", () => {
  it("says the half of the day once when both ends share it", () => {
    expect(blockHours(14, 18)).toBe("2 to 6 PM");
    expect(blockHours(8, 11)).toBe("8 to 11 AM");
    expect(blockHours(10, 14)).toBe("10 AM to 2 PM");
    expect(blockHours(12, 13)).toBe("12 to 1 PM");
  });
});

describe("spansOf", () => {
  it("reads an event in local hours, minutes as a fraction", () => {
    // 2:30 to 3:30 PM in New York (UTC-5 in November).
    expect(
      spansOf(
        new Date("2026-11-02T19:30:00Z"),
        new Date("2026-11-02T20:30:00Z"),
        "America/New_York",
      ),
    ).toEqual([{ key: "2026-11-02", from: 14.5, to: 15.5 }]);
  });

  it("splits an event that runs past midnight", () => {
    expect(
      spansOf(new Date("2026-11-02T22:00:00Z"), new Date("2026-11-03T02:00:00Z"), "UTC"),
    ).toEqual([
      { key: "2026-11-02", from: 22, to: 24 },
      { key: "2026-11-03", from: 0, to: 2 },
    ]);
  });
});
