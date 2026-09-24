// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import expected from "@/lib/org-chart/__fixtures__/expected.json";
import { normalizeOrgChart, type NormalizedPosition } from "@/lib/org-chart/normalize";

import { BUILTIN_CONFIDENCE_THRESHOLD, parseOrgChartText, scoreConfidence } from ".";

/**
 * The built-in parser against the Claude Builders Club chart written five
 * different ways, plus the messy documents a real club hands in. Every
 * shape has to normalize to the chart in expected.json, which is also what
 * the seed publishes as version 1.
 *
 * Two documented differences from Claude's reading of the same document,
 * both of them judgement rather than structure:
 *  - open items. The CBC document does not state any; Claude infers two.
 *    The parser reports the lines it could not place instead of inventing
 *    questions, so its open items are always empty.
 *  - the President's first decision. The document says "Final say on
 *    budget, ..."; Claude paraphrases the first item as "Budget (final
 *    say)", the parser keeps the document's word, "Budget". A document that
 *    writes a "Decides alone:" line outright (the table fixture) matches
 *    exactly.
 */

const dir = path.resolve("src/lib/org-chart/__fixtures__");
const read = (name: string) => readFileSync(path.join(dir, name), "utf8");

const PARAPHRASED = "Budget (final say)";
const VERBATIM = "Budget";

type Expected = Omit<NormalizedPosition, "sourceQuote"> & { sourceQuote: string[] };

const EXPECTED = expected.positions as unknown as Expected[];

/** expected.json with the paraphrase replaced by the document's own word. */
function asWritten(position: Expected): Expected {
  if (position.key !== "president") return position;
  return { ...position, decidesAlone: position.decidesAlone.map((d) => (d === PARAPHRASED ? VERBATIM : d)) };
}

const COMPARED = [
  "title",
  "personName",
  "reportsTo",
  "manages",
  "advisors",
  "responsibilities",
  "decidesAlone",
  "isOpen",
  "isAdvisor",
] as const;

function compare(positions: readonly NormalizedPosition[], want: readonly Expected[]): void {
  expect([...positions.map((p) => p.key)].sort()).toEqual([...want.map((p) => p.key)].sort());
  const byKey = new Map(positions.map((p) => [p.key, p]));
  for (const target of want) {
    const got = byKey.get(target.key);
    expect(got, `position ${target.key}`).toBeDefined();
    for (const field of COMPARED) {
      expect(got?.[field], `${target.key}.${field}`).toEqual(target[field]);
    }
  }
}

/**
 * Every shape of the CBC document. `statesDecisions` marks the fixtures
 * that write a "Decides alone" value outright, which need no allowance for
 * the President's paraphrase.
 */
const SHAPES = [
  { file: "cbc-fall-2026.md", shape: "sections", why: "a heading and a Reports to line per person (markdown)" },
  { file: "cbc-fall-2026.txt", shape: "sections", why: "a heading and a Reports to line per person (plain text)" },
  { file: "cbc-headings.md", shape: "sections", why: "a markdown heading hierarchy with bullets underneath" },
  { file: "cbc-outline.txt", shape: "outline", why: "an indented outline" },
  { file: "cbc-tree.txt", shape: "outline", why: "a drawn ASCII tree" },
  { file: "cbc-bullets.md", shape: "outline", why: "bullet lists with dash-indentation" },
  { file: "cbc-table.md", shape: "table", why: "a Title | Name | Reports to table", statesDecisions: true },
] as const;

describe("the built-in parser on the CBC chart", () => {
  for (const shapeCase of SHAPES) {
    const { file, shape, why } = shapeCase;
    const statesDecisions = "statesDecisions" in shapeCase && shapeCase.statesDecisions;
    it(`reads ${why} into the published chart (${file})`, () => {
      const { parse, report } = parseOrgChartText(read(file));
      expect(report.shape).toBe(shape);
      expect(report.positions).toBe(9);
      expect(report.confidence).toBeGreaterThanOrEqual(BUILTIN_CONFIDENCE_THRESHOLD);

      const chart = normalizeOrgChart(parse);
      expect(chart.warnings).toEqual([]);
      compare(chart.positions, statesDecisions ? EXPECTED : EXPECTED.map(asWritten));
      // The parser never invents the questions a document leaves open.
      expect(chart.openItems).toEqual([]);
    });
  }

  it("matches expected.json exactly when the document states its decisions outright", () => {
    const chart = normalizeOrgChart(parseOrgChartText(read("cbc-table.md")).parse);
    compare(chart.positions, EXPECTED);
  });

  it("keeps the document's own lines as the source quote", () => {
    const chart = normalizeOrgChart(parseOrgChartText(read("cbc-fall-2026.md")).parse);
    const byKey = new Map(chart.positions.map((p) => [p.key, p]));
    for (const want of EXPECTED) {
      expect(byKey.get(want.key)?.sourceQuote, want.key).toEqual(want.sourceQuote);
    }
  });

  it("keeps the order the document lists the roles in", () => {
    const chart = normalizeOrgChart(parseOrgChartText(read("cbc-fall-2026.md")).parse);
    expect(chart.positions.map((p) => p.key)).toEqual(EXPECTED.map((p) => p.key));
  });
});

describe("the drawn diagram from the spec's seed section", () => {
  // The exact block at the top of the CBC document: boxes side by side,
  // "+---+---+" bars and "|--" sibling lists, with the short titles the
  // drawing uses rather than the full ones from the sections below it.
  const diagram = [
    "                     President (Jackson)",
    "                     + Partnerships",
    "                            |",
    "                            |-- Advisor (Mehr)",
    "                            |",
    "        +-------------------+-------------------+",
    "  VP Ops & Programs    Head of Finance       VP Growth",
    "     (Oliver)            (Anthony)            (Lucas)",
    "        |                                      |",
    "  |-- Programs (Alex)                   |-- Social & Membership (Kristine)",
    "  |-- Tech (Smyan)                      |-- Graphic Designer [OPEN HIRE]",
  ].join("\n");

  it("reads every box, its person and who it hangs from", () => {
    const { parse, report } = parseOrgChartText(diagram);
    expect(report.shape).toBe("diagram");
    expect(report.orphanCount).toBe(0);
    const chart = normalizeOrgChart(parse);
    const structure = chart.positions.map((p) => [p.title, p.personName, p.reportsTo, p.isOpen, p.isAdvisor]);
    expect(structure).toEqual([
      ["President", "Jackson", null, false, false],
      ["Advisor", "Mehr", "president", false, true],
      ["VP Ops & Programs", "Oliver", "president", false, false],
      ["Head of Finance", "Anthony", "president", false, false],
      ["VP Growth", "Lucas", "president", false, false],
      ["Programs", "Alex", "vp-ops-programs", false, false],
      ["Social & Membership", "Kristine", "vp-growth", false, false],
      ["Tech", "Smyan", "vp-ops-programs", false, false],
      ["Graphic Designer", null, "vp-growth", true, false],
    ]);
    expect(chart.positions.find((p) => p.key === "president")?.responsibilities).toEqual(["Partnerships"]);
  });

  it("does not override the sections written underneath it", () => {
    // The same diagram inside the real document: the fuller sections win,
    // and the diagram's lines still count as understood.
    const { report } = parseOrgChartText(read("cbc-fall-2026.md"));
    expect(report.shape).toBe("sections");
    expect(report.orphanLines.some((l) => l.includes("President (Jackson)"))).toBe(false);
  });
});

describe("messy documents", () => {
  it("survives inconsistent indentation", () => {
    const { parse, report } = parseOrgChartText(
      [
        "President — Jackson Lamoureux",
        "      VP Ops & Programs — Oliver Ward",
        "   Head of Programs — Alex Green",
        "\t\tHead of Tech — Smyan Sengupta",
        "  VP Growth — Lucas Salzgeber",
      ].join("\n"),
    );
    const chart = normalizeOrgChart(parse);
    expect(chart.positions.map((p) => p.key)).toEqual([
      "president",
      "vp-ops-programs",
      "head-of-programs",
      "head-of-tech",
      "vp-growth",
    ]);
    // Everything still hangs off the President; the exact depth of the
    // jagged middle rows is a judgement the admin makes in the editor.
    expect(chart.positions.filter((p) => p.reportsTo === null)).toHaveLength(1);
    expect(report.positions).toBe(5);
  });

  it("keeps a position whose person the document never names", () => {
    const { parse, report } = parseOrgChartText(
      [
        "## President — Jackson Lamoureux",
        "Reports to: N/A",
        "",
        "## Head of Finance",
        "Reports to: Jackson",
        "- Keeps the budget tracker",
        "",
        "## Graphic Designer",
        "Reports to: Jackson",
        "Status: open hire",
      ].join("\n"),
    );
    const chart = normalizeOrgChart(parse);
    expect(chart.positions.map((p) => [p.key, p.personName, p.isOpen])).toEqual([
      ["president", "Jackson Lamoureux", false],
      ["head-of-finance", null, false],
      ["graphic-designer", null, true],
    ]);
    // Two of three positions name nobody, so the reading is less certain.
    expect(report.identified).toBe(2);
    expect(report.confidence).toBeLessThan(1);
  });

  it("keeps both entries when a person is listed twice, without merging them", () => {
    const { parse } = parseOrgChartText(
      [
        "## President — Jackson Lamoureux",
        "Reports to: N/A",
        "",
        "## Head of Partnerships — Jackson Lamoureux",
        "Reports to: President",
        "",
        "## Head of Tech — Smyan Sengupta",
        "Reports to: President",
      ].join("\n"),
    );
    const chart = normalizeOrgChart(parse);
    expect(chart.positions.map((p) => p.key)).toEqual(["president", "head-of-partnerships", "head-of-tech"]);
    expect(chart.positions.filter((p) => p.personName === "Jackson Lamoureux")).toHaveLength(2);
    expect(chart.positions[1].reportsTo).toBe("president");
  });

  it("reads a reporting line through a typo or odd casing", () => {
    const { parse } = parseOrgChartText(
      [
        "## President — Jackson Lamoureux",
        "",
        "## VP Growth — Lucas Salzgeber",
        "Reports To: Jackson Lamoureux",
        "",
        "## Head of Tech — Smyan Sengupta",
        "Reprots to: Jackson Lamoureux",
        "",
        "## Head of Finance — Anthony Jones",
        "REPORTS-TO: Jackson Lamoureux",
      ].join("\n"),
    );
    const chart = normalizeOrgChart(parse);
    expect(chart.positions.map((p) => p.reportsTo)).toEqual([null, "president", "president", "president"]);
  });

  it("gives up rather than inventing a chart out of prose", () => {
    const { parse, report } = parseOrgChartText(
      [
        "Our club runs on trust and a shared calendar.",
        "Everyone pitches in on workshops, and we meet on Sunday evenings",
        "to talk about what went well and what did not.",
        "Ask in the Slack channel if you want to help with something.",
      ].join("\n"),
    );
    expect(parse.positions).toHaveLength(0);
    expect(report.confidence).toBe(0);
    expect(report.shape).toBe("none");
    expect(report.notes).toContain("No positions were found in this document.");
  });

  it("scores a half-read document below the threshold", () => {
    const { report } = parseOrgChartText(
      [
        "Board notes, fall semester",
        "",
        "President — Jackson Lamoureux",
        "Head of Tech — Smyan Sengupta",
        "",
        "Everything else is still being worked out. We had a long conversation",
        "about whether the design work should sit under growth or under programs,",
        "and we did not settle it. Anthony is handling money for now. Kristine is",
        "doing social. We will write this up properly before the next meeting.",
      ].join("\n"),
    );
    expect(report.positions).toBeLessThan(3);
    expect(report.confidence).toBeLessThan(BUILTIN_CONFIDENCE_THRESHOLD);
    expect(report.orphanCount).toBeGreaterThan(0);
  });

  it("reports the lines it could not place", () => {
    const { report } = parseOrgChartText(read("cbc-fall-2026.md"));
    expect(report.orphanCount).toBe(7);
    expect(report.orphanLines).toContain("### How we work (use for defaults in Tasks)");
    expect(report.notes).toContain("7 lines could not be placed under a position.");
  });
});

describe("the confidence measure", () => {
  it("is zero for fewer than two positions", () => {
    expect(
      scoreConfidence({ positions: 1, identified: 1, linked: 0, roots: 1, linesConsidered: 1, linesUsed: 1 }),
    ).toBe(0);
  });

  it("is one when every line was placed, every position linked and every person named", () => {
    expect(
      scoreConfidence({ positions: 5, identified: 5, linked: 4, roots: 1, linesConsidered: 20, linesUsed: 20 }),
    ).toBe(1);
  });

  it("falls with unplaced lines, loose positions and unnamed people", () => {
    const coverage = scoreConfidence({
      positions: 5,
      identified: 5,
      linked: 4,
      roots: 1,
      linesConsidered: 20,
      linesUsed: 10,
    });
    const linkage = scoreConfidence({
      positions: 5,
      identified: 5,
      linked: 1,
      roots: 4,
      linesConsidered: 20,
      linesUsed: 20,
    });
    const people = scoreConfidence({
      positions: 5,
      identified: 1,
      linked: 4,
      roots: 1,
      linesConsidered: 20,
      linesUsed: 20,
    });
    expect(coverage).toBeCloseTo(0.8, 3);
    expect(linkage).toBeCloseTo(0.76, 3);
    expect(people).toBeCloseTo(0.84, 3);
    expect(BUILTIN_CONFIDENCE_THRESHOLD).toBe(0.7);
  });

  it("puts a document that is only half understood under the threshold", () => {
    expect(
      scoreConfidence({ positions: 6, identified: 4, linked: 2, roots: 3, linesConsidered: 40, linesUsed: 22 }),
    ).toBeLessThan(BUILTIN_CONFIDENCE_THRESHOLD);
  });
});
