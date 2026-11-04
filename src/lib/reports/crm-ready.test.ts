// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BOARD_COLUMNS } from "@/lib/boards";

import { readWidgets, reportWidgetsSchema, widgetsFor, type SourceSummary } from "./catalog";
import { isReadyReport, readyKindsFor, readyReport, readyReports } from "./crm-ready";
import { crmInsightLines } from "./crm-widgets";

const source = (crm: SourceSummary["crm"], name = "Partnerships"): SourceSummary => ({
  key: `custom:${name.toLowerCase()}`,
  kind: "custom",
  name,
  icon: "Handshake",
  description: "",
  href: "/x",
  fields: [],
  rows: 3,
  form: null,
  crm,
});

const pipeline = source({ kind: "pipeline", pipelineId: "p1", hasAmount: true });
const people = source({ kind: "people" }, "People");

describe("the CRM's ready-made reports", () => {
  it("offers Deals on a pipeline, People and Outreach on People, nothing elsewhere", () => {
    expect(readyKindsFor(pipeline)).toEqual(["deals"]);
    expect(readyKindsFor(people)).toEqual(["people", "outreach"]);
    expect(readyKindsFor(source({ kind: "companies" }, "Companies"))).toEqual([]);
    expect(readyKindsFor(source(undefined, "Books"))).toEqual([]);
    expect(readyReports([pipeline, people]).map((r) => [r.kind, r.title])).toEqual([
      ["deals", "Partnerships"],
      ["people", "People"],
      ["outreach", "Outreach"],
    ]);
  });

  it("puts the classics right under Insights on Deals and People", () => {
    for (const r of [readyReport("deals", pipeline), readyReport("people", people)]) {
      expect(r.widgets.slice(0, 4).map((w) => w.type)).toEqual([
        "insights",
        "crm-talked-to",
        "crm-converted",
        "crm-top-issues",
      ]);
    }
    expect(readyReport("deals", pipeline).widgets.map((w) => w.type)).toEqual(
      expect.arrayContaining(["crm-won", "crm-open", "crm-won-months", "crm-deals-by-stage", "crm-deals-by-owner", "crm-deals-by-type"]),
    );
    expect(readyReport("outreach", people).widgets.map((w) => w.type)).toEqual([
      "insights",
      "crm-sent",
      "crm-reply-rate",
      "crm-unsubscribes",
      "crm-replies-by-plan",
      "crm-best-time",
    ]);
  });

  it("lays every report out in full rows the catalog can save on its database", () => {
    for (const [kind, s] of [
      ["deals", pipeline],
      ["people", people],
      ["outreach", people],
    ] as const) {
      const r = readyReport(kind, s);
      expect(reportWidgetsSchema.safeParse(r.widgets).success).toBe(true);
      expect(readWidgets(r.widgets)).toHaveLength(r.widgets.length);
      const allowed = new Set(widgetsFor(s, false));
      expect(r.widgets.every((w) => allowed.has(w.type))).toBe(true);
      // Each row adds up to the board's width.
      let used = 0;
      for (const w of r.widgets) {
        used += w.w;
        if (used >= BOARD_COLUMNS) {
          expect(used).toBe(BOARD_COLUMNS);
          used = 0;
        }
      }
      expect(used).toBe(0);
    }
  });

  it("knows its own report by its mark, on its own database only", () => {
    const r = readyReport("deals", pipeline);
    expect(isReadyReport(r, "deals", pipeline.key)).toBe(true);
    expect(isReadyReport(r, "deals", "custom:other")).toBe(false);
    expect(isReadyReport({ source: people.key, widgets: [{ type: "crm-talked-to" }] }, "outreach", people.key)).toBe(false);
  });
});

describe("the CRM widgets in Insights", () => {
  it("adds their sentences, the warnings first", () => {
    const lines = crmInsightLines([
      { widget: { id: "a", type: "number" }, title: "Rows", payload: { type: "number", data: {} } },
      {
        widget: { id: "t", type: "crm-talked-to" },
        title: "People talked to",
        payload: { type: "crm-talked-to", data: { line: { text: "You talked to 4 people.", tone: "info" } } },
      },
      {
        widget: { id: "q", type: "crm-quiet" },
        title: "Going quiet",
        payload: { type: "crm-quiet", data: { line: { text: "2 people have gone quiet.", tone: "warn", bold: "2" } } },
      },
      { widget: { id: "w", type: "crm-won" }, title: "Won", payload: { type: "crm-won", data: { line: null } } },
    ]);
    expect(lines.map((l) => [l.widgetId, l.tone])).toEqual([
      ["q", "warn"],
      ["t", "info"],
    ]);
    expect(lines[0]).toMatchObject({ label: "Going quiet", bold: "2", next: null });
  });
});
