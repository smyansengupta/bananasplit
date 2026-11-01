import { describe, expect, it } from "vitest";

import { zonedDateTimeLocal } from "@/lib/calendar/dates";

import { MAX_SERIES_WEEKS, weeklyOccurrences } from "./series";

const NY = "America/New_York";

describe("weeklyOccurrences", () => {
  it("repeats weekly through the last day, keeping the wall-clock time across a DST change", () => {
    // Thu Oct 22 2026, 6-7 PM EDT. DST ends Sun Nov 1.
    const first = {
      startsAt: new Date("2026-10-22T22:00:00Z"),
      endsAt: new Date("2026-10-22T23:00:00Z"),
      allDay: false,
    };
    const weeks = weeklyOccurrences(first, "2026-11-05", NY);

    expect(weeks.map((w) => zonedDateTimeLocal(w.startsAt, NY))).toEqual([
      "2026-10-22T18:00",
      "2026-10-29T18:00",
      "2026-11-05T18:00",
    ]);
    expect(weeks.map((w) => zonedDateTimeLocal(w.endsAt, NY))).toEqual([
      "2026-10-22T19:00",
      "2026-10-29T19:00",
      "2026-11-05T19:00",
    ]);
  });

  it("is just the meeting itself when the last day is before the next week or invalid", () => {
    const first = {
      startsAt: new Date("2026-10-22T22:00:00Z"),
      endsAt: new Date("2026-10-22T23:00:00Z"),
      allDay: false,
    };
    expect(weeklyOccurrences(first, "2026-10-25", NY)).toHaveLength(1);
    expect(weeklyOccurrences(first, "nope", NY)).toHaveLength(1);
  });

  it("stops at the cap", () => {
    const first = {
      startsAt: new Date("2026-01-01T15:00:00Z"),
      endsAt: new Date("2026-01-01T16:00:00Z"),
      allDay: false,
    };
    expect(weeklyOccurrences(first, "2030-01-01", NY)).toHaveLength(MAX_SERIES_WEEKS);
  });
});
