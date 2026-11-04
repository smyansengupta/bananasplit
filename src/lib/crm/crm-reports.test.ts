// @vitest-environment node
import { describe, expect, it } from "vitest";

import { daypartOf, heatGrid, monthKeys, monthLabel, parseReportPath } from "./crm-reports";

describe("the old CRM report links", () => {
  it("reads which report and which pipeline", () => {
    expect(parseReportPath(undefined)).toEqual({ on: "deals", pipelineId: null });
    expect(parseReportPath(["deals", "p_1"])).toEqual({ on: "deals", pipelineId: "p_1" });
    expect(parseReportPath(["deals", "a b"])).toEqual({ on: "deals", pipelineId: null });
    expect(parseReportPath(["people"])).toEqual({ on: "people", pipelineId: null });
    expect(parseReportPath(["outreach", "x"])).toEqual({ on: "outreach", pipelineId: null });
  });
});

describe("months on a chart", () => {
  it("shows the range's months up to today", () => {
    expect(monthKeys("2026-10-01", "2026-12-31", "2026-11-03")).toEqual(["2026-10", "2026-11"]);
    expect(monthKeys("2026-01-01", "2026-12-31", "2026-11-03")).toHaveLength(11);
  });

  it("shows the last six for all time, across a year", () => {
    expect(monthKeys(null, null, "2026-02-10")).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("keeps at most the latest twelve", () => {
    const keys = monthKeys("2024-01-01", "2026-06-30", "2026-11-03");
    expect(keys).toHaveLength(12);
    expect(keys.at(-1)).toBe("2026-06");
  });

  it("labels a month", () => {
    expect(monthLabel("2026-09")).toBe("Sep");
  });
});

describe("the best time to send", () => {
  it("puts hours in parts of the day", () => {
    expect([6, 10, 11, 13, 14, 17, 18, 2].map(daypartOf)).toEqual([
      "Morning",
      "Morning",
      "Midday",
      "Midday",
      "Afternoon",
      "Afternoon",
      "Evening",
      "Evening",
    ]);
  });

  it("reads the rate per weekday and part, skipping weekends and thin cells", () => {
    const grid = heatGrid([
      { dow: 2, hour: 9, sent: 10, replied: 4 },
      { dow: 2, hour: 10, sent: 10, replied: 4 },
      { dow: 3, hour: 15, sent: 10, replied: 1 },
      { dow: 1, hour: 9, sent: 3, replied: 3 },
      { dow: 6, hour: 9, sent: 50, replied: 50 },
    ]);
    const morning = grid.rows.find((r) => r.part === "Morning")!;
    expect(morning.cells.map((c) => c.rate)).toEqual([null, 0.4, null, null, null]);
    expect(grid.best).toEqual({ day: "Tue", part: "Morning", rate: 0.4, sent: 20 });
    expect(grid.max).toBe(0.4);
  });

  it("has no best with too few", () => {
    expect(heatGrid([{ dow: 2, hour: 9, sent: 2, replied: 2 }]).best).toBeNull();
  });
});

