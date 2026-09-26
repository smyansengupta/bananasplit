import { describe, expect, it, vi } from "vitest";

import { computeManagers, computeReportingSubtree } from "@/server/org-chart/queries";

import {
  emptyViewerChart,
  isFlaggedRelation,
  relationFor,
  userDepths,
  type ChartNode,
  type ViewerChart,
} from "./assignment";

// queries.ts reaches the database through the wrappers (hoisted mock); only
// its pure helpers are used here.
vi.mock("@/server/db/context", () => ({ withSystemOrgTx: vi.fn() }));

// The seeded Claude Builders Club chart (spec 'Seed data').
const CHART: ChartNode[] = [
  { id: "p-president", userId: "jackson", reportsToId: null, isAdvisor: false },
  { id: "p-advisor", userId: "mehr", reportsToId: "p-president", isAdvisor: true },
  { id: "p-vp-ops", userId: "oliver", reportsToId: "p-president", isAdvisor: false },
  { id: "p-finance", userId: "anthony", reportsToId: "p-president", isAdvisor: false },
  { id: "p-vp-growth", userId: "lucas", reportsToId: "p-president", isAdvisor: false },
  { id: "p-programs", userId: "alex", reportsToId: "p-vp-ops", isAdvisor: false },
  { id: "p-tech", userId: "smyan", reportsToId: "p-vp-ops", isAdvisor: false },
  { id: "p-social", userId: "kristine", reportsToId: "p-vp-growth", isAdvisor: false },
  { id: "p-designer", userId: null, reportsToId: "p-vp-growth", isAdvisor: false },
];

/** What src/server/tasks/assignment-policy.ts builds for the acting user. */
function viewer(userId: string, positions: ChartNode[] = CHART): ViewerChart {
  if (positions.length === 0) return emptyViewerChart(userId);
  return {
    viewerId: userId,
    hasChart: true,
    subtree: computeReportingSubtree(positions, userId).userIds,
    managers: computeManagers(positions, userId),
    depth: userDepths(positions),
  };
}

describe("classifyAssignment over the CBC chart", () => {
  it("Oliver to Alex is DOWN_LINE and not flagged", () => {
    const rel = relationFor(viewer("oliver"), "alex");
    expect(rel).toBe("DOWN_LINE");
    expect(isFlaggedRelation(rel)).toBe(false);
  });

  it("Alex to Oliver is ABOVE and flagged", () => {
    const rel = relationFor(viewer("alex"), "oliver");
    expect(rel).toBe("ABOVE");
    expect(isFlaggedRelation(rel)).toBe(true);
  });

  it("Kristine to Alex is PEER", () => {
    expect(relationFor(viewer("kristine"), "alex")).toBe("PEER");
  });

  it("self is SELF and unflagged", () => {
    const rel = relationFor(viewer("alex"), "alex");
    expect(rel).toBe("SELF");
    expect(isFlaggedRelation(rel)).toBe(false);
  });

  it("an empty chart is OUTSIDE_CHART", () => {
    const rel = relationFor(viewer("alex", []), "oliver");
    expect(rel).toBe("OUTSIDE_CHART");
    expect(isFlaggedRelation(rel)).toBe(false);
  });

  it("a VP hands down to the whole line, the President to everyone below", () => {
    expect(relationFor(viewer("lucas"), "kristine")).toBe("DOWN_LINE");
    expect(relationFor(viewer("jackson"), "smyan")).toBe("DOWN_LINE");
    expect(relationFor(viewer("jackson"), "lucas")).toBe("DOWN_LINE");
  });

  it("assigning to a higher level in another line is ABOVE", () => {
    // Alex (Head of Programs) to Lucas (VP Growth): not his manager, but above his level.
    expect(relationFor(viewer("alex"), "lucas")).toBe("ABOVE");
    expect(relationFor(viewer("kristine"), "jackson")).toBe("ABOVE");
  });

  it("a cross-line assignment downward is PEER, not DOWN_LINE", () => {
    expect(relationFor(viewer("oliver"), "kristine")).toBe("PEER");
  });

  it("advisors and people without a position are OUTSIDE_CHART", () => {
    expect(relationFor(viewer("jackson"), "mehr")).toBe("OUTSIDE_CHART");
    expect(relationFor(viewer("mehr"), "jackson")).toBe("OUTSIDE_CHART");
    expect(relationFor(viewer("oliver"), "someone-new")).toBe("OUTSIDE_CHART");
  });

  it("depths put the President at 0, VPs at 1 and heads at 2", () => {
    expect(userDepths(CHART)).toEqual({
      jackson: 0,
      oliver: 1,
      anthony: 1,
      lucas: 1,
      alex: 2,
      smyan: 2,
      kristine: 2,
    });
  });

  it("tolerates a cycle", () => {
    const cyclic: ChartNode[] = [
      { id: "a", userId: "u1", reportsToId: "b", isAdvisor: false },
      { id: "b", userId: "u2", reportsToId: "a", isAdvisor: false },
    ];
    expect(() => relationFor(viewer("u1", cyclic), "u2")).not.toThrow();
  });
});
