import { describe, expect, it } from "vitest";

import {
  calendarYear,
  formatPeriodDate,
  formatPeriodRange,
  fromDateValue,
  periodCovers,
  quarter,
  toDateValue,
} from "./periods";

const on = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe("budget period presets", () => {
  it("quarters run three calendar months", () => {
    expect(quarter(on(2026, 9, 30))).toEqual({
      label: "Q3 2026",
      startsOn: "2026-07-01",
      endsOn: "2026-09-30",
    });
    expect(quarter(on(2027, 2, 1))).toEqual({
      label: "Q1 2027",
      startsOn: "2027-01-01",
      endsOn: "2027-03-31",
    });
    expect(quarter(on(2027, 12, 31)).label).toBe("Q4 2027");
  });

  it("calendar years run Jan 1 to Dec 31", () => {
    expect(calendarYear(on(2026, 9, 30))).toEqual({
      label: "2026",
      startsOn: "2026-01-01",
      endsOn: "2026-12-31",
    });
  });
});

describe("stored dates", () => {
  it("reads only real YYYY-MM-DD days, as UTC midnight", () => {
    expect(fromDateValue("2026-08-01")?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(fromDateValue("2026-02-30")).toBeNull();
    expect(fromDateValue("8/1/2026")).toBeNull();
    expect(fromDateValue("")).toBeNull();
    expect(toDateValue(fromDateValue("2027-07-31")!)).toBe("2027-07-31");
  });

  it("formats in UTC, so Aug 1 never prints as Jul 31", () => {
    expect(formatPeriodDate(new Date("2026-08-01T00:00:00.000Z"))).toBe("Aug 1, 2026");
    expect(formatPeriodRange("2026-08-01", "2027-07-31")).toBe("Aug 1, 2026 – Jul 31, 2027");
  });

  it("covers both end days", () => {
    const p = { startsOn: fromDateValue("2026-08-01")!, endsOn: fromDateValue("2027-07-31")! };
    expect(periodCovers(p, new Date("2026-08-01T15:00:00Z"))).toBe(true);
    expect(periodCovers(p, new Date("2027-07-31T23:00:00Z"))).toBe(true);
    expect(periodCovers(p, new Date("2027-08-01T01:00:00Z"))).toBe(false);
  });
});
