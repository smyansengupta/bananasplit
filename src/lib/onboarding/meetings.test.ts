import { describe, expect, it } from "vitest";

import { meetingOccurrences } from "./org";

describe("meetingOccurrences", () => {
  // Tuesday Sep 29 2026, 20:00 UTC = 4 PM in New York.
  const now = new Date("2026-09-29T20:00:00Z");
  const ny = "America/New_York";

  it("starts at the next local weekday and time, in the org's zone", () => {
    const [first, second] = meetingOccurrences(
      { day: 0, minutes: 19 * 60, cadence: "weekly" },
      ny,
      now,
      12,
    );
    // Monday Oct 5, 7 PM EDT = 23:00 UTC.
    expect(first.toISOString()).toBe("2026-10-05T23:00:00.000Z");
    expect(second.toISOString()).toBe("2026-10-12T23:00:00.000Z");
  });

  it("uses today when the meeting is still ahead, next week when it has passed", () => {
    const later = meetingOccurrences({ day: 1, minutes: 18 * 60, cadence: "weekly" }, ny, now, 1);
    expect(later.map((d) => d.toISOString())).toEqual(["2026-09-29T22:00:00.000Z"]);
    const passed = meetingOccurrences({ day: 1, minutes: 9 * 60, cadence: "weekly" }, ny, now, 2);
    expect(passed[0].toISOString()).toBe("2026-10-06T13:00:00.000Z");
  });

  it("covers about a semester, every other week for biweekly, across the DST change", () => {
    const weekly = meetingOccurrences({ day: 2, minutes: 18 * 60, cadence: "weekly" }, ny, now, 12);
    const biweekly = meetingOccurrences(
      { day: 2, minutes: 18 * 60, cadence: "biweekly" },
      ny,
      now,
      12,
    );
    expect(weekly).toHaveLength(12);
    expect(biweekly).toHaveLength(6);
    // Nov 4 is after DST ends (Nov 1): still 6 PM local, now 23:00 UTC.
    expect(weekly.map((d) => d.toISOString())).toContain("2026-11-04T23:00:00.000Z");
  });
});
