import { describe, expect, it } from "vitest";

import {
  addDaysToKey,
  allDayInstants,
  allDaySpan,
  parseDateKey,
  parseZonedDateTimeLocal,
  safeTimeZone,
  zonedDateKey,
  zonedDateTimeLocal,
  zonedMidnight,
  zonedTimeToInstant,
} from "./dates";

const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";
const LA = "America/Los_Angeles";

describe("calendar dates in an org timezone", () => {
  it("reads the calendar date of an instant in the zone", () => {
    const instant = new Date("2026-10-10T02:30:00.000Z");
    expect(zonedDateKey(instant, "UTC")).toBe("2026-10-10");
    expect(zonedDateKey(instant, NY)).toBe("2026-10-09"); // west of UTC: the evening before
    expect(zonedDateKey(instant, TOKYO)).toBe("2026-10-10");
  });

  it("does date-key arithmetic across months and leap days", () => {
    expect(addDaysToKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(() => addDaysToKey("nope", 1)).toThrow();
  });

  it("finds local midnight east and west of UTC", () => {
    expect(zonedMidnight("2026-10-10", NY).toISOString()).toBe("2026-10-10T04:00:00.000Z");
    expect(zonedMidnight("2026-12-10", NY).toISOString()).toBe("2026-12-10T05:00:00.000Z");
    expect(zonedMidnight("2026-10-10", TOKYO).toISOString()).toBe("2026-10-09T15:00:00.000Z");
    expect(zonedMidnight("2026-10-10", "UTC").toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });

  it("handles DST: a skipped time moves forward, an ambiguous one takes the earlier instant", () => {
    // 2026-03-08 02:30 does not exist in New York.
    expect(zonedTimeToInstant("2026-03-08", NY, 2, 30).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    // 2026-11-01 01:30 happens twice in New York; the first is EDT (UTC-4).
    expect(zonedTimeToInstant("2026-11-01", NY, 1, 30).toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
    expect(zonedTimeToInstant("2026-07-01", LA, 18, 0).toISOString()).toBe(
      "2026-07-02T01:00:00.000Z",
    );
  });

  it("reads all-day spans with exclusive and inclusive ends alike", () => {
    const { startsAt, endsAt } = allDayInstants("2026-10-10", "2026-10-11", NY);
    expect(startsAt.toISOString()).toBe("2026-10-10T04:00:00.000Z");
    expect(endsAt.toISOString()).toBe("2026-10-12T04:00:00.000Z");
    expect(allDaySpan(startsAt, endsAt, NY)).toEqual({
      start: "2026-10-10",
      lastDay: "2026-10-11",
      endExclusive: "2026-10-12",
    });
    // Legacy rows: 23:59:59 on the last day.
    const inclusiveEnd = new Date("2026-10-11T03:59:59.000Z"); // 23:59:59 on the 10th in New York
    expect(allDaySpan(startsAt, inclusiveEnd, NY)).toEqual({
      start: "2026-10-10",
      lastDay: "2026-10-10",
      endExclusive: "2026-10-11",
    });
    // An end at the start is one day.
    expect(allDaySpan(startsAt, startsAt, NY).endExclusive).toBe("2026-10-11");
    // East of UTC.
    const tokyo = allDayInstants("2026-10-10", "2026-10-10", TOKYO);
    expect(allDaySpan(tokyo.startsAt, tokyo.endsAt, TOKYO)).toMatchObject({
      start: "2026-10-10",
      endExclusive: "2026-10-11",
    });
  });

  it("round-trips datetime-local values in the zone", () => {
    const at = parseZonedDateTimeLocal("2026-10-10T18:00", NY);
    expect(at?.toISOString()).toBe("2026-10-10T22:00:00.000Z");
    expect(zonedDateTimeLocal(at!, NY)).toBe("2026-10-10T18:00");
    expect(parseZonedDateTimeLocal("2026-10-10T25:00", NY)).toBeNull();
    expect(parseZonedDateTimeLocal("garbage", NY)).toBeNull();
  });

  it("falls back to UTC for an unknown zone", () => {
    expect(safeTimeZone("Mars/Olympus")).toBe("UTC");
    expect(safeTimeZone(null)).toBe("UTC");
    expect(safeTimeZone(NY)).toBe(NY);
  });
});
