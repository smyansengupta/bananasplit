import { describe, expect, it } from "vitest";

import {
  addDaysToKey,
  dueBucket,
  dueDateKey,
  effectiveTimezone,
  formatDueKey,
  fromDateKey,
  isDateKey,
  localDateKey,
  localHour,
  weekBounds,
  weekStartKey,
  zonedInstant,
} from "./dates";

const NY = "America/New_York";

describe("floating due dates", () => {
  it("round-trips date keys through UTC midnight", () => {
    expect(fromDateKey("2026-10-03").toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(dueDateKey(fromDateKey("2026-10-03"))).toBe("2026-10-03");
    expect(addDaysToKey("2026-10-30", 5)).toBe("2026-11-04");
  });

  it("validates keys", () => {
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-1-1")).toBe(false);
  });

  it("formats without shifting the day", () => {
    expect(formatDueKey("2026-10-03", "2026-09-30")).toBe("Sat, Oct 3");
    expect(formatDueKey("2027-01-04", "2026-09-30")).toBe("Mon, Jan 4, 2027");
  });
});

describe("time zones", () => {
  it("falls back from the user's zone to the org's to UTC", () => {
    expect(effectiveTimezone({ timezone: "Europe/Paris" }, { timezone: NY })).toBe("Europe/Paris");
    expect(effectiveTimezone({ timezone: null }, { timezone: NY })).toBe(NY);
    expect(effectiveTimezone({ timezone: "Not/AZone" }, { timezone: "bogus" })).toBe("UTC");
  });

  it("builds local instants across DST", () => {
    // 09:00 in New York: EDT (UTC-4) before Nov 1 2026, EST (UTC-5) after.
    expect(zonedInstant("2026-10-30", 9, NY).toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(zonedInstant("2026-11-02", 9, NY).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(localHour(new Date("2026-11-02T13:00:00Z"), NY)).toBe(8);
    expect(localDateKey(new Date("2026-11-03T03:30:00Z"), NY)).toBe("2026-11-02");
  });
});

describe("Sunday-update weeks (Monday 00:00 to Sunday 23:59, org time)", () => {
  it("puts a Sunday 23:30 EST completion in the week that started on Monday", () => {
    // Sunday 2026-11-08 23:30 EST = 2026-11-09 04:30 UTC.
    const sundayNight = new Date("2026-11-09T04:30:00Z");
    expect(weekStartKey(sundayNight, NY)).toBe("2026-11-02");
    const { start, end } = weekBounds("2026-11-02", NY);
    expect(sundayNight >= start && sundayNight < end).toBe(true);
  });

  it("starts the next week at Monday 00:00 local", () => {
    expect(weekStartKey(new Date("2026-11-09T05:00:00Z"), NY)).toBe("2026-11-09");
  });

  it("spans the DST change (a 169-hour week)", () => {
    const { start, end } = weekBounds("2026-10-26", NY);
    expect(start.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});

describe("My Tasks buckets", () => {
  const today = "2026-09-23"; // a Wednesday
  it.each([
    [null, "none"],
    ["2026-09-22", "overdue"],
    ["2026-09-23", "today"],
    ["2026-09-27", "thisWeek"],
    ["2026-09-28", "later"],
  ] as const)("%s is %s", (due, bucket) => {
    expect(dueBucket(due, today)).toBe(bucket);
  });
});
