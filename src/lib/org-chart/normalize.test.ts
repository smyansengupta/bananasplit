import { describe, expect, it } from "vitest";

import raw from "./__fixtures__/cbc-fall-2026.raw.json";
import expected from "./__fixtures__/expected.json";
import { normalizeOrgChart } from "./normalize";
import { OrgChartParseSchema, type OrgChartParse, type RawPosition } from "./schema";

const P = (over: Partial<RawPosition> & Pick<RawPosition, "id" | "title">): RawPosition => ({
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
const parse = (positions: RawPosition[], open_items: OrgChartParse["open_items"] = []) =>
  normalizeOrgChart({ positions, open_items });

describe("normalizeOrgChart on the CBC fixture", () => {
  const result = normalizeOrgChart(OrgChartParseSchema.parse(raw));
  const byKey = new Map(result.positions.map((p) => [p.key, p]));

  it("matches expected.json exactly, with no warnings", () => {
    expect(result).toEqual(expected);
    expect(result.warnings).toEqual([]);
  });

  it("builds the CBC tree", () => {
    expect(byKey.get("president")?.reportsTo).toBeNull();
    expect(byKey.get("founder-advisor")).toMatchObject({ reportsTo: "president", isAdvisor: true });
    for (const vp of ["vp-ops-programs", "vp-growth", "head-of-finance"]) {
      expect(byKey.get(vp)?.reportsTo).toBe("president");
    }
    expect(byKey.get("head-of-programs")?.reportsTo).toBe("vp-ops-programs");
    expect(byKey.get("head-of-tech")?.reportsTo).toBe("vp-ops-programs");
    expect(byKey.get("head-of-social-membership")?.reportsTo).toBe("vp-growth");
    expect(byKey.get("graphic-designer")).toMatchObject({
      reportsTo: "vp-growth",
      isOpen: true,
      personName: null,
    });
    const leaves = result.positions.filter((p) => p.manages.length === 0 && p.advisors.length === 0);
    expect(leaves).toHaveLength(6);
    expect(result.positions.filter((p) => p.isAdvisor)).toHaveLength(1);
  });

  it("lists the advisor beside the President, not under 'manages' (the Mehr case)", () => {
    expect(byKey.get("president")?.manages).toEqual(["vp-ops-programs", "vp-growth", "head-of-finance"]);
    expect(byKey.get("president")?.advisors).toEqual(["founder-advisor"]);
  });

  it("resolves 'manages' written as names ('Kristine', 'Designer') without warnings", () => {
    expect(byKey.get("vp-growth")?.manages).toEqual(["head-of-social-membership", "graphic-designer"]);
  });
});

describe("normalizeOrgChart rules", () => {
  it("re-keys by title slug with collision suffixes", () => {
    const r = parse([
      P({ id: "a", title: "VP Ops & Programs" }),
      P({ id: "b", title: "VP Ops / Programs", reports_to: "a" }),
      P({ id: "c", title: "  ", reports_to: "a" }),
    ]);
    expect(r.positions.map((p) => p.key)).toEqual(["vp-ops-programs", "vp-ops-programs-2"]);
    expect(r.warnings.map((w) => w.code)).toContain("empty-title");
  });

  it("fills a missing reports_to from the manager's 'manages', and keeps reports_to when they disagree", () => {
    const r = parse([
      P({ id: "boss", title: "President", manages: ["x", "y"] }),
      P({ id: "other", title: "VP", reports_to: "boss" }),
      P({ id: "x", title: "Lead X" }),
      P({ id: "y", title: "Lead Y", reports_to: "other" }),
    ]);
    const byKey = new Map(r.positions.map((p) => [p.key, p]));
    expect(byKey.get("lead-x")?.reportsTo).toBe("president");
    expect(byKey.get("lead-y")?.reportsTo).toBe("vp");
    expect(r.warnings.map((w) => w.code).sort()).toEqual(["manages-filled", "manages-mismatch"]);
    // manages is recomputed from reports_to.
    expect(byKey.get("president")?.manages).toEqual(["vp", "lead-x"]);
    expect(byKey.get("vp")?.manages).toEqual(["lead-y"]);
  });

  it("drops a dangling or self reference with a warning", () => {
    const r = parse([
      P({ id: "a", title: "President" }),
      P({ id: "b", title: "VP", reports_to: "ghost" }),
      P({ id: "c", title: "Lead", reports_to: "c" }),
    ]);
    expect(r.positions.every((p) => p.reportsTo === null)).toBe(true);
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("dangling");
    expect(codes).toContain("self-reference");
    expect(codes).toContain("multiple-roots");
  });

  it("breaks a cycle at the earliest position in it", () => {
    const r = parse([
      P({ id: "a", title: "Alpha", reports_to: "c" }),
      P({ id: "b", title: "Beta", reports_to: "a" }),
      P({ id: "c", title: "Gamma", reports_to: "b" }),
    ]);
    const byKey = new Map(r.positions.map((p) => [p.key, p]));
    expect(byKey.get("alpha")?.reportsTo).toBeNull();
    expect(byKey.get("beta")?.reportsTo).toBe("alpha");
    expect(byKey.get("gamma")?.reportsTo).toBe("beta");
    expect(r.warnings.filter((w) => w.code === "cycle")).toHaveLength(1);
  });

  it("unflags an advisor with no manager or with reports", () => {
    const r = parse([
      P({ id: "a", title: "President" }),
      P({ id: "b", title: "Advisor", reports_to: "a", is_advisor: true }),
      P({ id: "c", title: "Intern", reports_to: "b" }),
      P({ id: "d", title: "Floating Advisor", is_advisor: true }),
    ]);
    const byKey = new Map(r.positions.map((p) => [p.key, p]));
    expect(byKey.get("advisor")?.isAdvisor).toBe(false);
    expect(byKey.get("floating-advisor")?.isAdvisor).toBe(false);
    expect(r.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(["advisor-has-reports", "advisor-no-manager"]),
    );
  });

  it("gives an open position no person, and reads open markers as open", () => {
    const r = parse([
      P({ id: "a", title: "Designer", person_name: "[OPEN HIRE]" }),
      P({ id: "b", title: "Editor", person_name: "Sam Lee", is_open: true }),
      P({ id: "c", title: "Writer", person_name: "TBD" }),
    ]);
    expect(r.positions.map((p) => [p.isOpen, p.personName])).toEqual([
      [true, null],
      [true, null],
      [true, null],
    ]);
    expect(r.warnings.map((w) => w.code)).toContain("open-with-person");
  });

  it("cleans, deduplicates and clamps bullets and strings", () => {
    const long = "x".repeat(1000);
    const r = parse(
      [
        P({
          id: "a",
          title: `  Head\u0000 of‮  Tech ${long}`,
          responsibilities: ["- Ships the site", "• ships the  site", "", "1. Runs QA", long, ...Array(40).fill("y")],
        }),
      ],
      [
        { who: "Lucas", question: "When?" },
        { who: "lucas", question: "when?" },
        { who: "x", question: "" },
      ],
    );
    const p = r.positions[0];
    expect(p.title.length).toBeLessThanOrEqual(120);
    expect(p.title.startsWith("Head of Tech")).toBe(true);
    expect(p.responsibilities.slice(0, 2)).toEqual(["Ships the site", "Runs QA"]);
    expect(p.responsibilities[2].length).toBeLessThanOrEqual(400);
    expect(p.responsibilities.length).toBeLessThanOrEqual(25);
    expect(r.openItems).toEqual([{ who: "Lucas", question: "When?" }]);
  });

  it("keeps the first of two positions sharing an id", () => {
    const r = parse([
      P({ id: "x", title: "President" }),
      P({ id: "x", title: "Treasurer" }),
      P({ id: "y", title: "Lead", reports_to: "x" }),
    ]);
    expect(r.positions.find((p) => p.key === "lead")?.reportsTo).toBe("president");
    expect(r.warnings.map((w) => w.code)).toContain("duplicate-id");
  });

  it("reports an empty document", () => {
    expect(parse([]).warnings.map((w) => w.code)).toEqual(["no-positions"]);
  });
});
