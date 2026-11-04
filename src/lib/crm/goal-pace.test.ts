// @vitest-environment node
import { describe, expect, it } from "vitest";

import { formatGoal, goalPeriods, goalTitle, paceWords, parseTarget, projectPace } from "./goal-pace";

describe("a goal's pace", () => {
  const q4 = { start: "2026-10-01", end: "2026-12-31" };

  it("projects what's done over the share of the period gone", () => {
    // Oct 1 to Nov 15 is 46 of 92 days: half way.
    expect(projectPace(50, q4, "2026-11-15")).toBeCloseTo(100);
    expect(projectPace(50, q4, "2026-09-01")).toBe(50);
    expect(projectPace(50, q4, "2027-02-01")).toBe(50);
  });

  it("says where it lands and how far from the target", () => {
    const w = paceWords("items_won", 5, 12, q4, "2026-11-15");
    expect(w.pace).toBe("At this pace you'll reach 10 deals by Dec 31.");
    expect(w.sub).toBe("So far 5 deals. About 2 deals short of the 12 deals target.");
    expect(w.soFarShare).toBeCloseTo(5 / 12);
    const clear = paceWords("amount_won", 1_850_000, 1_000_000, q4, "2026-11-15");
    expect(clear.sub).toBe("So far $18,500. That clears the $10,000 target.");
    expect(paceWords("replies", 3, 10, q4, "2027-01-05").pace).toBe("It ended at 3 replies.");
  });

  it("formats and reads targets", () => {
    expect(formatGoal("amount_won", 2_500_000)).toBe("$25,000");
    expect(formatGoal("replies", 1)).toBe("1 reply");
    expect(parseTarget("$25,000")).toBe(25000);
    expect(parseTarget("abc")).toBeNull();
    expect(parseTarget("0")).toBeNull();
  });

  it("names the goal and its periods", () => {
    expect(goalTitle("amount_won", null, "This quarter")).toBe("Money won this quarter");
    expect(goalTitle("replies", { me: true, name: "Jack Lam" }, "This year")).toBe("Your replies this year");
    expect(goalTitle("meetings", { me: false, name: "Kristine Ro" }, "Q1 2026")).toBe("Kristine's meetings in Q1 2026");
    const periods = goalPeriods("2026-11-03", { key: "2026-Q1", label: "Q1 2026", start: "2026-01-01", end: "2026-03-31" });
    expect(periods.map((p) => [p.key, p.label])).toEqual([
      ["2026-Q4", "This quarter"],
      ["2026", "This year"],
      ["2026-Q1", "Q1 2026"],
    ]);
  });
});
