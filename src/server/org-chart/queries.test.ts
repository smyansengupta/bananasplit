import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/context", () => ({ withSystemOrgTx: vi.fn(), withOrgTx: vi.fn() }));

import { computeManagers, computeReportingSubtree } from "./queries";

// The Claude Builders Club chart from the spec.
const P = (id: string, userId: string | null, reportsToId: string | null, isAdvisor = false) => ({
  id,
  userId,
  reportsToId,
  isAdvisor,
});
const chart = [
  P("president", "jackson", null),
  P("advisor", "mehr", "president", true),
  P("vp-ops", "oliver", "president"),
  P("finance", "anthony", "president"),
  P("vp-growth", "lucas", "president"),
  P("programs", "alex", "vp-ops"),
  P("tech", "smyan", "vp-ops"),
  P("social", "kristine", "vp-growth"),
  P("designer", null, "vp-growth"), // open hire
];

describe("computeReportingSubtree", () => {
  it("returns everyone below a VP", () => {
    const sub = computeReportingSubtree(chart, "oliver");
    expect(sub.positionIds.sort()).toEqual(["programs", "tech"]);
    expect(sub.userIds.sort()).toEqual(["alex", "smyan"]);
  });

  it("includes open positions but no user for them", () => {
    const sub = computeReportingSubtree(chart, "lucas");
    expect(sub.positionIds.sort()).toEqual(["designer", "social"]);
    expect(sub.userIds).toEqual(["kristine"]);
  });

  it("excludes advisors from the President's subtree", () => {
    const sub = computeReportingSubtree(chart, "jackson");
    expect(sub.userIds.sort()).toEqual(["alex", "anthony", "kristine", "lucas", "oliver", "smyan"]);
    expect(sub.positionIds).not.toContain("advisor");
  });

  it("is empty for a lead with no reports, an advisor, a non-member or an empty chart", () => {
    expect(computeReportingSubtree(chart, "kristine").userIds).toEqual([]);
    expect(computeReportingSubtree(chart, "mehr").userIds).toEqual([]);
    expect(computeReportingSubtree(chart, "nobody").userIds).toEqual([]);
    expect(computeReportingSubtree([], "jackson")).toEqual({ positionIds: [], userIds: [] });
  });

  it("tolerates a cycle", () => {
    const cyclic = [P("a", "u1", "b"), P("b", "u2", "a")];
    expect(computeReportingSubtree(cyclic, "u1").userIds).toEqual(["u2"]);
  });
});

describe("computeManagers", () => {
  it("walks up the chain, nearest first", () => {
    expect(computeManagers(chart, "smyan")).toEqual(["oliver", "jackson"]);
    expect(computeManagers(chart, "jackson")).toEqual([]);
    // An advisor's own position is not in the hierarchy.
    expect(computeManagers(chart, "mehr")).toEqual([]);
  });
});
