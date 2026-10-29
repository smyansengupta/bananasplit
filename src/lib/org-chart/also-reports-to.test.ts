import { describe, expect, it } from "vitest";

import { diffCharts, type DiffPosition } from "./diff";
import {
  addAlsoReportsTo,
  extraManagerOptions,
  moveDraft,
  removeAlsoReportsTo,
  removePosition,
  setManager,
  toValidationNodes,
  type DraftPosition,
} from "./draft";
import { chartToSvg } from "./export";
import { layoutOrgChart } from "./layout";
import { normalizeOrgChart } from "./normalize";
import { applyOutline, parseOutline, serializeOutline } from "./outline";
import type { RawPosition } from "./schema";
import { indexChart } from "./tree";
import { hasErrors, validateChart } from "./validate";

// A member under their team's Director, who also reports to Kristine.
const P = (id: string, reportsTo: string | null, rank: string, over: Partial<DraftPosition> = {}): DraftPosition => ({
  id,
  key: id,
  title: id,
  personName: null,
  userId: null,
  matchState: "UNMATCHED",
  matchScore: null,
  suggestedUserIds: [],
  reportsTo,
  isOpen: false,
  isAdvisor: false,
  responsibilities: [],
  decidesAlone: [],
  sourceQuote: [],
  rank,
  ...over,
});

const CHART: DraftPosition[] = [
  P("president", null, "a0", { title: "President" }),
  P("advisor", "president", "a1", { title: "Faculty advisor", isAdvisor: true }),
  P("director", "president", "a2", { title: "Director of Programs" }),
  P("growth", "president", "a3", { title: "Head of Growth", personName: "Kristine Min" }),
  P("member", "director", "a0", { title: "Programs member", personName: "Alex Doe" }),
];

const withAlso = (positions: DraftPosition[], id: string, also: string[]) =>
  positions.map((p) => (p.id === id ? { ...p, alsoReportsTo: also } : p));

const layoutInput = (positions: DraftPosition[]) =>
  positions.map((p) => ({ id: p.id, reportsToId: p.reportsTo, alsoReportsToIds: p.alsoReportsTo, isAdvisor: p.isAdvisor, rank: p.rank }));

describe("layout and tree", () => {
  const chart = withAlso(CHART, "member", ["growth"]);

  it("draws a dotted edge to each extra manager and leaves the tree where it was", () => {
    const plain = layoutOrgChart(layoutInput(CHART));
    const dotted = layoutOrgChart(layoutInput(chart));
    expect(dotted.nodes).toEqual(plain.nodes);
    expect(dotted.edges.filter((e) => e.kind === "dotted")).toEqual([
      { id: "d:growth:member", source: "growth", target: "member", kind: "dotted" },
    ]);
    expect(dotted.edges).toContainEqual(expect.objectContaining({ source: "director", target: "member", kind: "reports" }));
  });

  it("skips the main manager, the position itself and managers not on the canvas", () => {
    const layout = layoutOrgChart(layoutInput(withAlso(CHART, "member", ["director", "member", "gone"])));
    expect(layout.edges.filter((e) => e.kind === "dotted")).toEqual([]);
    const folded = layoutOrgChart(layoutInput(chart.filter((p) => p.id !== "growth")));
    expect(folded.edges.filter((e) => e.kind === "dotted")).toEqual([]);
  });

  it("indexes extra managers and dotted-line reports", () => {
    const index = indexChart(chart.map((p) => ({ ...p, reportsToId: p.reportsTo, alsoReportsToIds: p.alsoReportsTo })));
    expect(index.managerOf("member")?.id).toBe("director");
    expect(index.alsoManagersOf("member").map((p) => p.id)).toEqual(["growth"]);
    expect(index.dottedReportsOf("growth").map((p) => p.id)).toEqual(["member"]);
    expect(index.reportsOf("growth")).toEqual([]);
  });

  it("exports the dotted line as a dashed path", () => {
    const layout = layoutOrgChart(layoutInput(chart));
    const nodes = new Map(
      chart.map((p) => [p.id, { id: p.id, title: p.title, subtitle: "", initials: "X", color: null, dashed: false }]),
    );
    const palette = { background: "#fff", card: "#fff", foreground: "#000", muted: "#eee", mutedForeground: "#666", border: "#ddd" };
    expect(chartToSvg(layout, nodes, palette)).toContain('stroke-dasharray="3 5"');
  });
});

describe("draft operations", () => {
  it("adds and removes an extra manager", () => {
    const added = addAlsoReportsTo(CHART, "member", "growth");
    expect(added?.find((p) => p.id === "member")?.alsoReportsTo).toEqual(["growth"]);
    const removed = removeAlsoReportsTo(added!, "member", "growth");
    expect(removed.find((p) => p.id === "member")?.alsoReportsTo).toEqual([]);
  });

  it("offers neither the main manager, an advisor, the position itself nor anyone below it", () => {
    expect(extraManagerOptions(CHART, "member").map((p) => p.id)).toEqual(["president", "growth"]);
    expect(extraManagerOptions(CHART, "director").map((p) => p.id)).toEqual(["growth"]);
    expect(addAlsoReportsTo(CHART, "member", "director")).toBeNull();
    expect(addAlsoReportsTo(CHART, "member", "advisor")).toBeNull();
    expect(addAlsoReportsTo(CHART, "director", "member")).toBeNull();
    expect(addAlsoReportsTo(withAlso(CHART, "member", ["growth"]), "member", "growth")).toBeNull();
  });

  it("drops an extra manager that becomes the main one", () => {
    const chart = withAlso(CHART, "member", ["growth", "president"]);
    expect(setManager(chart, "member", "growth")?.find((p) => p.id === "member")?.alsoReportsTo).toEqual(["president"]);
    expect(moveDraft(chart, "member", "president", "inside")?.find((p) => p.id === "member")?.alsoReportsTo).toEqual([
      "growth",
    ]);
  });

  it("removes the dotted lines to a deleted position", () => {
    const next = removePosition(withAlso(CHART, "member", ["growth"]), "growth");
    expect(next.find((p) => p.id === "member")?.alsoReportsTo).toEqual([]);
  });
});

describe("validation", () => {
  const codes = (positions: DraftPosition[]) => validateChart(toValidationNodes(positions)).map((i) => i.code);

  it("accepts a second manager", () => {
    expect(hasErrors(validateChart(toValidationNodes(withAlso(CHART, "member", ["growth"]))))).toBe(false);
  });

  it("rejects an unknown position, an advisor and someone below", () => {
    expect(codes(withAlso(CHART, "member", ["gone"]))).toContain("unknown-also-manager");
    expect(codes(withAlso(CHART, "member", ["advisor"]))).toContain("also-to-advisor");
    expect(codes(withAlso(CHART, "director", ["member"]))).toContain("also-loop");
  });
});

describe("diffCharts", () => {
  const D = (key: string, reportsToKey: string | null, alsoReportsToKeys: string[] = []): DiffPosition => ({
    key,
    title: key,
    reportsToKey,
    alsoReportsToKeys,
    userId: null,
    personLabel: "Unfilled",
    personName: null,
    isOpen: false,
    isAdvisor: false,
    responsibilities: [],
    decidesAlone: [],
  });

  it("reports extra managers added and removed", () => {
    const before = [D("president", null), D("growth", "president"), D("ops", "president"), D("member", "ops", ["ops-x"])];
    const after = [D("president", null), D("growth", "president"), D("ops", "president"), D("member", "ops", ["growth"])];
    expect(diffCharts(before, after)).toEqual([
      { type: "dotted", key: "member", title: "member", added: ["growth"], removed: ["ops-x"] },
    ]);
    expect(diffCharts(after, after)).toEqual([]);
  });
});

describe("imports", () => {
  const R = (over: Partial<RawPosition> & Pick<RawPosition, "id" | "title">): RawPosition => ({
    person_name: null,
    reports_to: null,
    manages: [],
    responsibilities: [],
    decides_alone: [],
    is_open: false,
    is_advisor: false,
    source_quote: [],
    ...over,
  });

  it("resolves also_reports_to by id or name and keeps the tree from reports_to", () => {
    const chart = normalizeOrgChart({
      positions: [
        R({ id: "p", title: "President" }),
        R({ id: "d", title: "Director of Programs", reports_to: "p" }),
        R({ id: "g", title: "Head of Growth", person_name: "Kristine Min", reports_to: "p" }),
        R({ id: "m", title: "Programs member", reports_to: "d", also_reports_to: ["Kristine", "d", "nobody"] }),
      ],
      open_items: [],
    });
    const member = chart.positions.find((p) => p.key === "programs-member");
    expect(member?.reportsTo).toBe("director-of-programs");
    expect(member?.alsoReportsTo).toEqual(["head-of-growth"]);
    expect(chart.warnings.map((w) => w.code)).toEqual(["dangling"]);
  });

  it("drops a line to an advisor or to someone below, with a warning", () => {
    const chart = normalizeOrgChart({
      positions: [
        R({ id: "p", title: "President" }),
        R({ id: "a", title: "Advisor", reports_to: "p", is_advisor: true }),
        R({ id: "d", title: "Director", reports_to: "p", also_reports_to: ["m"] }),
        R({ id: "m", title: "Member", reports_to: "d", also_reports_to: ["a"] }),
      ],
      open_items: [],
    });
    expect(chart.positions.every((p) => p.alsoReportsTo.length === 0)).toBe(true);
    expect(chart.warnings.map((w) => w.code)).toEqual(["also-reports-dropped", "also-reports-dropped"]);
  });
});

describe("the typed outline", () => {
  const members = [{ id: "kristine", name: "Kristine Min" }];

  it("reads (also reports to ...) and writes it back", () => {
    const text = [
      "President",
      "  Director of Programs",
      "    Programs member — Alex Doe (also reports to Kristine)",
      "  Head of Growth — @Kristine Min",
    ].join("\n");
    const lines = parseOutline(text);
    expect(lines[2]).toMatchObject({ title: "Programs member", person: "Alex Doe", also: ["Kristine"] });
    const positions = applyOutline([], lines, members);
    const member = positions.find((p) => p.title === "Programs member")!;
    const growth = positions.find((p) => p.title === "Head of Growth")!;
    expect(member.alsoReportsTo).toEqual([growth.id]);
    expect(member.reportsTo).toBe(positions.find((p) => p.title === "Director of Programs")!.id);
    expect(serializeOutline(positions, members)).toContain("Programs member — Alex Doe (also reports to Kristine Min)");
  });

  it("names an extra manager by title when the person is ambiguous or absent", () => {
    const positions = applyOutline([], parseOutline("President\n  Director\n    Member (also reports to: President)"), []);
    expect(positions.find((p) => p.title === "Member")?.alsoReportsTo).toEqual([positions[0].id]);
    expect(serializeOutline(positions, [])).toContain("Member (also reports to President)");
  });

  it("keeps a title with other parentheses as typed", () => {
    expect(parseOutline("Treasurer (also Secretary)")[0]).toMatchObject({ title: "Treasurer (also Secretary)", also: [] });
  });
});
