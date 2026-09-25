import { describe, expect, it } from "vitest";

import { diffCharts, type DiffPosition } from "./diff";
import { effectiveParents, H_GAP, layoutOrgChart, NODE_HEIGHT, NODE_WIDTH } from "./layout";
import { hasErrors, validateChart, type ValidationNode } from "./validate";

// The CBC chart, by key.
const CBC: [string, string | null, boolean][] = [
  ["president", null, false],
  ["founder-advisor", "president", true],
  ["vp-ops-programs", "president", false],
  ["vp-growth", "president", false],
  ["head-of-finance", "president", false],
  ["head-of-programs", "vp-ops-programs", false],
  ["head-of-tech", "vp-ops-programs", false],
  ["head-of-social-membership", "vp-growth", false],
  ["graphic-designer", "vp-growth", false],
];

describe("layoutOrgChart", () => {
  const layout = layoutOrgChart(
    CBC.map(([id, reportsToId, isAdvisor], i) => ({ id, reportsToId, isAdvisor, rank: `a${i}` })),
  );
  const at = new Map(layout.nodes.map((n) => [n.id, n]));

  it("places every position once, top-down", () => {
    expect(layout.nodes).toHaveLength(9);
    expect(at.get("president")?.y).toBe(0);
    expect(at.get("vp-ops-programs")?.y).toBeGreaterThan(0);
    expect(at.get("head-of-tech")!.y).toBeGreaterThan(at.get("vp-ops-programs")!.y);
  });

  it("puts the advisor beside the President on a side branch with a dashed edge", () => {
    const advisor = at.get("founder-advisor")!;
    const president = at.get("president")!;
    expect(advisor.kind).toBe("advisor");
    expect(advisor.y).toBe(president.y);
    expect(advisor.x).toBe(president.x + NODE_WIDTH + H_GAP);
    expect(layout.edges).toContainEqual(
      expect.objectContaining({ source: "president", target: "founder-advisor", kind: "advisor" }),
    );
    expect(layout.edges.filter((e) => e.kind === "reports")).toHaveLength(7);
  });

  it("never overlaps two nodes", () => {
    for (const a of layout.nodes) {
      for (const b of layout.nodes) {
        if (a === b) continue;
        const overlapX = Math.abs(a.x - b.x) < NODE_WIDTH;
        const overlapY = Math.abs(a.y - b.y) < NODE_HEIGHT;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it("orders siblings by rank and survives several roots, loops and missing managers", () => {
    const l = layoutOrgChart([
      { id: "b", reportsToId: null, isAdvisor: false, rank: "a1" },
      { id: "a", reportsToId: null, isAdvisor: false, rank: "a0" },
      { id: "x", reportsToId: "y", isAdvisor: false, rank: "a2" },
      { id: "y", reportsToId: "x", isAdvisor: false, rank: "a3" },
      { id: "z", reportsToId: "ghost", isAdvisor: false, rank: "a4" },
    ]);
    const pos = new Map(l.nodes.map((n) => [n.id, n]));
    expect(l.nodes).toHaveLength(5);
    expect(pos.get("a")!.x).toBeLessThan(pos.get("b")!.x);
    expect(effectiveParents([{ id: "z", reportsToId: "ghost", isAdvisor: false, rank: "a" }]).get("z")).toBeNull();
  });

  it("handles an empty chart", () => {
    expect(layoutOrgChart([])).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });
});

const V = (over: Partial<ValidationNode> & Pick<ValidationNode, "id">): ValidationNode => ({
  key: over.id,
  title: over.id,
  reportsTo: null,
  isAdvisor: false,
  isOpen: false,
  userId: null,
  personName: null,
  matchState: "UNMATCHED",
  ...over,
});

describe("validateChart", () => {
  it("accepts the CBC chart", () => {
    const nodes = CBC.map(([id, reportsTo, isAdvisor]) => V({ id, reportsTo, isAdvisor }));
    expect(validateChart(nodes)).toEqual([]);
  });

  it("blocks loops, foreign managers, bad advisors, open hires with members and ex-members", () => {
    const issues = validateChart(
      [
        V({ id: "a", reportsTo: "b" }),
        V({ id: "b", reportsTo: "a" }),
        V({ id: "c", reportsTo: "elsewhere" }),
        V({ id: "d", isAdvisor: true }),
        V({ id: "e", isAdvisor: true, reportsTo: "f" }),
        V({ id: "f" }),
        V({ id: "g", reportsTo: "e" }),
        V({ id: "h", isOpen: true, userId: "u1" }),
        V({ id: "i", userId: "gone", reportsTo: "f" }),
        V({ id: "j", key: "f", reportsTo: "f", title: " " }),
      ],
      { memberIds: new Set(["u1"]) },
    );
    const codes = issues.filter((i) => i.level === "error").map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "cycle",
        "unknown-manager",
        "advisor-no-manager",
        "advisor-has-reports",
        "open-with-member",
        "not-a-member",
        "duplicate-key",
        "no-title",
      ]),
    );
    expect(codes.filter((c) => c === "cycle")).toHaveLength(1);
    expect(hasErrors(issues)).toBe(true);
  });

  it("warns about several roots, unconfirmed suggestions and placeholders, without blocking", () => {
    const issues = validateChart([
      V({ id: "a" }),
      V({ id: "b", personName: "Sam", matchState: "SUGGESTED" }),
      V({ id: "c", reportsTo: "a", personName: "Pat" }),
    ]);
    expect(issues.map((i) => i.code).sort()).toEqual(["multiple-roots", "placeholder", "unconfirmed"]);
    expect(hasErrors(issues)).toBe(false);
  });

  it("blocks an empty chart", () => {
    expect(validateChart([]).map((i) => i.code)).toEqual(["empty"]);
  });
});

const D = (over: Partial<DiffPosition> & Pick<DiffPosition, "key">): DiffPosition => ({
  title: over.key,
  reportsToKey: null,
  userId: null,
  personLabel: "Unfilled",
  personName: null,
  isOpen: false,
  isAdvisor: false,
  responsibilities: [],
  decidesAlone: [],
  ...over,
});

describe("diffCharts", () => {
  it("reports additions, removals, retitles, moves, person and content changes", () => {
    const before = [
      D({ key: "president", title: "President", userId: "j", personLabel: "Jackson" }),
      D({ key: "vp", title: "VP", reportsToKey: "president", userId: "o", personLabel: "Oliver" }),
      D({ key: "lead", title: "Lead", reportsToKey: "vp", responsibilities: ["Ships"] }),
      D({ key: "old", title: "Old role", reportsToKey: "president" }),
      D({ key: "designer", title: "Designer", reportsToKey: "vp", isOpen: true, personLabel: "Open hire" }),
    ];
    const after = [
      D({ key: "president", title: "President", userId: "j", personLabel: "Jackson" }),
      D({ key: "vp", title: "VP Ops", reportsToKey: "president", userId: "o", personLabel: "Oliver" }),
      D({ key: "lead", title: "Lead", reportsToKey: "president", responsibilities: ["Ships", "Tests"] }),
      D({ key: "new", title: "New role", reportsToKey: "president" }),
      D({ key: "designer", title: "Designer", reportsToKey: "vp", userId: "k", personLabel: "Kim" }),
    ];
    const changes = diffCharts(before, after);
    expect(changes).toEqual([
      { type: "added", key: "new", title: "New role", person: "Unfilled" },
      { type: "removed", key: "old", title: "Old role", person: "Unfilled" },
      { type: "retitled", key: "vp", from: "VP", to: "VP Ops" },
      { type: "reparented", key: "lead", title: "Lead", from: "VP", to: "President" },
      { type: "person", key: "designer", title: "Designer", from: "Open hire", to: "Kim" },
      { type: "content", key: "lead", title: "Lead", field: "responsibilities", added: ["Tests"], removed: [] },
    ]);
  });

  it("pairs a re-keyed position by its member", () => {
    const changes = diffCharts(
      [D({ key: "vp-ops", title: "VP Ops", userId: "o", personLabel: "Oliver" })],
      [D({ key: "vp-operations", title: "VP Operations", userId: "o", personLabel: "Oliver" })],
    );
    expect(changes).toEqual([{ type: "retitled", key: "vp-operations", from: "VP Ops", to: "VP Operations" }]);
  });

  it("is empty for identical charts", () => {
    const chart = [D({ key: "a" }), D({ key: "b", reportsToKey: "a" })];
    expect(diffCharts(chart, chart)).toEqual([]);
  });
});
