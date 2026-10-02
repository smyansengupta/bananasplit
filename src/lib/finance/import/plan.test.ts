import { describe, expect, it } from "vitest";

import { coveringPeriod, draftPeriodFor, periodStyle, planPeriods, type PeriodLike } from "./plan";

const period = (id: string, startsOn: string, endsOn: string, isActive = false): PeriodLike => ({
  id,
  label: id,
  startsOn,
  endsOn,
  isActive,
});

describe("which period a date lands in", () => {
  it("prefers the active period, then the latest-starting one", () => {
    const year = period("year", "2026-08-01", "2027-07-31");
    const fall = period("fall", "2026-08-01", "2026-12-31", true);
    expect(coveringPeriod([year, fall], "2026-09-05")?.id).toBe("fall");
    expect(coveringPeriod([year, period("fall2", "2026-09-01", "2026-12-31")], "2026-09-05")?.id).toBe("fall2");
    expect(coveringPeriod([year], "2026-07-31")).toBeNull();
  });

  it("matches the club's own way of splitting the year", () => {
    expect(periodStyle([])).toBe("school-year");
    expect(periodStyle([period("f", "2026-08-01", "2026-12-31")])).toBe("semester");
    expect(periodStyle([period("y", "2026-01-01", "2026-12-31")])).toBe("calendar-year");
    expect(draftPeriodFor("2025-10-10", "school-year")).toEqual({ label: "2025–26", startsOn: "2025-08-01", endsOn: "2026-07-31" });
    expect(draftPeriodFor("2025-10-10", "semester").label).toBe("Fall 2025");
  });
});

describe("planPeriods", () => {
  it("makes one new period per year of old rows", () => {
    const current = period("cur", "2026-08-01", "2027-07-31", true);
    const plan = planPeriods([current], ["2025-09-05", "2026-02-01", "2026-09-01", "2024-10-10"]);
    expect(plan.drafts.map((d) => d.label).sort()).toEqual(["2024–25", "2025–26"]);
    expect(plan.targets.get("2026-09-01")).toEqual({ existing: "cur" });
    expect(plan.targets.get("2025-09-05")).toEqual(plan.targets.get("2026-02-01"));
  });

  it("never overlaps an existing period, and names the pieces apart", () => {
    const lastYear = period("2024–25", "2024-08-01", "2025-07-31");
    const oddOne = period("oct", "2025-10-01", "2025-10-31");
    const plan = planPeriods([lastYear, oddOne], ["2025-09-05", "2025-11-05"]);
    const before = plan.targets.get("2025-09-05");
    const after = plan.targets.get("2025-11-05");
    expect(before && "draft" in before && before.draft).toMatchObject({ startsOn: "2025-08-01", endsOn: "2025-09-30", label: "2025–26" });
    expect(after && "draft" in after && after.draft).toMatchObject({ startsOn: "2025-11-01", endsOn: "2026-07-31", label: "2025–26 (2)" });
  });
});
