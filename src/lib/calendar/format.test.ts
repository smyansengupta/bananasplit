import { describe, expect, it } from "vitest";

import { formatEventWhen } from "./format";

const zones = { viewer: "America/New_York", org: "America/New_York" };
// Monday, Oct 5, 2026, 10:00 in New York.
const now = new Date("2026-10-05T14:00:00Z");

// Newer ICU puts a narrow no-break space before AM/PM.
const when = (...args: Parameters<typeof formatEventWhen>) =>
  formatEventWhen(...args).replace(/ /g, " ");

describe("formatEventWhen", () => {
  it("names today and tomorrow in the viewer's zone", () => {
    expect(
      when(
        {
          startsAt: new Date("2026-10-05T22:00:00Z"),
          endsAt: new Date("2026-10-05T23:30:00Z"),
          allDay: false,
        },
        zones,
        now,
      ),
    ).toBe("Today, 6:00 PM – 7:30 PM");
    expect(
      when(
        {
          startsAt: new Date("2026-10-06T22:00:00Z"),
          endsAt: new Date("2026-10-07T00:00:00Z"),
          allDay: false,
        },
        zones,
        now,
      ),
    ).toBe("Tomorrow, 6:00 PM – 8:00 PM");
  });

  it("reads the same instant in the viewer's own zone, not the org's", () => {
    // 11pm in New York is already Wednesday morning in Berlin.
    expect(
      when(
        {
          startsAt: new Date("2026-10-07T03:00:00Z"),
          endsAt: new Date("2026-10-07T04:00:00Z"),
          allDay: false,
        },
        { viewer: "Europe/Berlin", org: "America/New_York" },
        now,
      ),
    ).toBe("Wed, Oct 7, 5:00 AM – 6:00 AM");
  });

  it("repeats the day when a timed event ends on another day", () => {
    expect(
      when(
        {
          startsAt: new Date("2026-10-09T03:00:00Z"),
          endsAt: new Date("2026-10-09T05:00:00Z"),
          allDay: false,
        },
        zones,
        now,
      ),
    ).toBe("Thu, Oct 8, 11:00 PM – Fri, Oct 9, 1:00 AM");
  });

  it("prints all-day events as whole days in the org's zone", () => {
    const allDay = (first: string, afterLast: string) => ({
      startsAt: new Date(first),
      endsAt: new Date(afterLast),
      allDay: true,
    });
    // Local midnight in New York is 04:00Z during daylight time.
    expect(when(allDay("2026-10-06T04:00:00Z", "2026-10-07T04:00:00Z"), zones, now)).toBe(
      "Tomorrow, all day",
    );
    expect(
      when(
        allDay("2026-10-10T04:00:00Z", "2026-10-12T04:00:00Z"),
        { viewer: "Asia/Tokyo", org: "America/New_York" },
        now,
      ),
    ).toBe("Sat, Oct 10 – Sun, Oct 11, all day");
  });

  it("adds the year when the event is in another year", () => {
    expect(
      when(
        {
          startsAt: new Date("2027-01-15T23:00:00Z"),
          endsAt: new Date("2027-01-16T01:00:00Z"),
          allDay: false,
        },
        zones,
        now,
      ),
    ).toBe("Fri, Jan 15, 2027, 6:00 PM – 8:00 PM");
  });
});
