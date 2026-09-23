import { describe, expect, it } from "vitest";

import {
  addDays,
  formatSpan,
  isIsoDate,
  rangeQuery,
  resolveReportRange,
  termBounds,
  termOfDate,
  termOfRange,
  todayIn,
} from "./range";

const NY = "America/New_York";

describe("resolveReportRange", () => {
  it("defaults to the current term by the July-1 rule in the org timezone", () => {
    const r = resolveReportRange({}, NY, new Date("2026-09-23T16:00:00Z"));
    expect(r).toMatchObject({
      preset: "term",
      from: "2026-07-01",
      to: "2026-12-31",
      term: "fall-2026",
      label: "Fall 2026",
      span: "Jul 1 – Dec 31, 2026",
    });
    const spring = resolveReportRange({ range: "term" }, NY, new Date("2027-02-01T12:00:00Z"));
    expect(spring).toMatchObject({ from: "2027-01-01", to: "2027-06-30", term: "spring-2027" });
  });

  it("uses the org's calendar date, not UTC's", () => {
    // 2026-07-01 02:00 UTC is still June 30 in New York: spring.
    const r = resolveReportRange({}, NY, new Date("2026-07-01T02:00:00Z"));
    expect(r.term).toBe("spring-2026");
    expect(resolveReportRange({}, "UTC", new Date("2026-07-01T02:00:00Z")).term).toBe("fall-2026");
  });

  it("resolves the last 30 days, today included", () => {
    const r = resolveReportRange({ range: "30d" }, NY, new Date("2026-09-23T16:00:00Z"));
    expect(r).toMatchObject({ preset: "30d", from: "2026-08-25", to: "2026-09-23", term: null, label: "Last 30 days" });
  });

  it("resolves all time to no bounds", () => {
    expect(resolveReportRange({ range: "all" }, NY)).toMatchObject({ preset: "all", from: null, to: null, span: null });
  });

  it("accepts a custom range and names it after a term when it is one", () => {
    expect(resolveReportRange({ from: "2026-09-01", to: "2026-09-30" }, NY)).toMatchObject({
      preset: "custom",
      term: null,
      label: "Sep 1 – Sep 30, 2026",
    });
    expect(resolveReportRange({ from: "2026-07-01", to: "2026-12-31", range: "all" }, NY)).toMatchObject({
      preset: "custom",
      term: "fall-2026",
      label: "Fall 2026",
    });
  });

  it("falls back to the term for malformed, reversed or huge custom ranges", () => {
    const now = new Date("2026-09-23T16:00:00Z");
    for (const params of [
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-09-30", to: "2026-09-01" },
      { from: "yesterday", to: "2026-09-01" },
      { from: "1900-01-01", to: "2999-12-31" },
      { from: ["2026-09-01", "x"], to: "nope" },
    ]) {
      expect(resolveReportRange(params, NY, now).preset).toBe("term");
    }
  });

  it("round-trips through rangeQuery", () => {
    const now = new Date("2026-09-23T16:00:00Z");
    for (const params of [{}, { range: "30d" }, { range: "all" }, { from: "2026-09-01", to: "2026-09-15" }]) {
      const r = resolveReportRange(params, NY, now);
      expect(resolveReportRange(rangeQuery(r), NY, now)).toEqual(r);
    }
  });
});

describe("date helpers", () => {
  it("validates real dates only", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-9-1")).toBe(false);
    expect(isIsoDate(20260901)).toBe(false);
  });

  it("does calendar arithmetic without timezone drift", () => {
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(todayIn(NY, new Date("2026-11-02T04:30:00Z"))).toBe("2026-11-01");
    expect(todayIn(NY, new Date("2026-11-02T05:30:00Z"))).toBe("2026-11-02");
  });

  it("splits terms at July 1", () => {
    expect(termOfDate("2026-06-30")).toBe("spring-2026");
    expect(termOfDate("2026-07-01")).toBe("fall-2026");
    expect(termBounds("spring-2027")).toEqual({ from: "2027-01-01", to: "2027-06-30" });
    expect(termOfRange("2026-07-01", "2026-12-31")).toBe("fall-2026");
    expect(termOfRange("2026-07-01", "2026-12-30")).toBeNull();
    expect(termOfRange(null, null)).toBeNull();
  });

  it("formats spans", () => {
    expect(formatSpan("2025-12-15", "2026-01-14")).toBe("Dec 15, 2025 – Jan 14, 2026");
    expect(formatSpan("2026-09-01", "2026-09-01")).toBe("Sep 1, 2026");
  });
});
