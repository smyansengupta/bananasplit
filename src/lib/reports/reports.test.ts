import { describe, expect, it } from "vitest";

import {
  CREATED,
  fillRows,
  newWidget,
  readWidgets,
  suggestedWidgets,
  widgetTitle,
  widgetsFor,
  type ReportField,
  type ReportWidget,
  type SourceSummary,
} from "./catalog";
import {
  computeReport,
  computeWidget,
  previousSpan,
  readInsights,
  type ComputeContext,
  type LoadedSource,
  type ReportRow,
} from "./compute";

const FIELDS: ReportField[] = [
  { id: "name", name: "Name", type: "TEXT" },
  {
    id: "stage",
    name: "Stage",
    type: "SELECT",
    choices: [
      { id: "c", label: "Contacted", color: "gray" },
      { id: "t", label: "Talking", color: "blue" },
      { id: "y", label: "Committed", color: "yellow" },
      { id: "p", label: "Paid", color: "green" },
    ],
    done: ["p"],
  },
  {
    id: "tier",
    name: "Tier",
    type: "SELECT",
    choices: [
      { id: "gold", label: "Gold", color: "yellow" },
      { id: "silver", label: "Silver", color: "gray" },
    ],
  },
  { id: "amount", name: "Amount", type: "CURRENCY" },
  { id: "follow", name: "Follow-up date", type: "DATE" },
  { id: "owner", name: "Owner", type: "MEMBER" },
];

const summary: SourceSummary = {
  key: "custom:sponsors",
  kind: "custom",
  name: "Sponsors",
  icon: "Handshake",
  description: "",
  href: "/app/x/databases/sponsors",
  fields: FIELDS,
  rows: 5,
  form: null,
};

function row(
  id: string,
  values: Record<string, unknown>,
  created: string,
  updated = created,
): ReportRow {
  return {
    id,
    title: String(values.name ?? ""),
    values,
    createdAt: `${created}T15:00:00.000Z`,
    updatedAt: `${updated}T15:00:00.000Z`,
    href: null,
  };
}

const source: LoadedSource = {
  ...summary,
  members: { u1: "Lucas Silva" },
  truncated: false,
  records: [
    row(
      "1",
      { name: "Figma", stage: "y", tier: "gold", amount: 1000, follow: "2026-10-27", owner: "u1" },
      "2026-08-20",
    ),
    row(
      "2",
      { name: "Vercel", stage: "t", tier: "silver", amount: 750, follow: "2026-11-20" },
      "2026-09-02",
    ),
    row(
      "3",
      { name: "Notion", stage: "p", tier: "gold", amount: 500, follow: "2026-10-01" },
      "2026-09-10",
    ),
    row("4", { name: "Stripe", stage: "c", amount: 2500 }, "2026-10-15", "2026-10-15"),
    row("5", { name: "Figma", stage: "c" }, "2026-05-01", "2026-05-01"),
  ],
};

const ctx: ComputeContext = {
  span: { from: "2026-07-01", to: "2026-12-31", label: "Jul 1 – Dec 31, 2026" },
  tz: "America/New_York",
  today: "2026-11-02",
};

const widget = (type: ReportWidget["type"], config: ReportWidget["config"] = {}): ReportWidget => ({
  id: type,
  type,
  w: 2,
  h: 1,
  config,
});

describe("the widget catalog", () => {
  it("ticks my picks for a database with a status, money, a due date and an owner", () => {
    expect(suggestedWidgets(summary, false)).toEqual([
      "insights",
      "number",
      "over-time",
      "breakdown",
      "pipeline",
      "top-values",
      "overdue",
    ]);
  });

  it("adds Database health for admins only, and Form results only with a form", () => {
    expect(suggestedWidgets(summary, true)).toContain("health");
    expect(widgetsFor(summary, false)).not.toContain("health");
    expect(widgetsFor(summary, true)).not.toContain("form-results");
    expect(widgetsFor({ ...summary, form: { title: "Apply", href: "/f" } }, true)).toContain(
      "form-results",
    );
  });

  it("leaves out widgets a database has nothing for", () => {
    const plain: SourceSummary = {
      ...summary,
      fields: [{ id: "name", name: "Name", type: "TEXT" }],
    };
    const types = widgetsFor(plain, true);
    expect(types).not.toContain("breakdown");
    expect(types).not.toContain("spread");
    expect(types).not.toContain("top-values");
    expect(types).toContain("number");
  });

  it("sets widgets up from the fields: money summed, the status as the pipeline, the due date for overdue", () => {
    expect(newWidget("number", summary, []).config).toMatchObject({ field: "amount", agg: "sum" });
    expect(newWidget("pipeline", summary, []).config).toEqual({ group: "stage" });
    expect(newWidget("breakdown", summary, []).config).toMatchObject({ group: "tier" });
    expect(newWidget("overdue", summary, []).config).toMatchObject({
      date: "follow",
      owner: "owner",
      group: "stage",
    });
  });

  it("gives a second widget of a type its own id", () => {
    const first = newWidget("number", summary, []);
    expect(newWidget("number", summary, [first]).id).toBe("number-2");
  });

  it("titles widgets from what they read", () => {
    expect(widgetTitle(newWidget("breakdown", summary, []), summary)).toBe("Amount by tier");
    expect(widgetTitle({ type: "number", config: { title: "Committed" } }, summary)).toBe(
      "Committed",
    );
    expect(
      widgetTitle({ type: "over-time", config: { date: CREATED, bucket: "month" } }, summary),
    ).toBe("Sponsors by month");
  });

  it("reads saved widgets, dropping broken and repeated ones", () => {
    const saved = [
      { id: "number", type: "number", w: 1, h: 1, config: {} },
      { id: "number", type: "spread", w: 1, h: 1, config: {} },
      { id: "x", type: "nope", w: 1, h: 1, config: {} },
      { id: "goal", type: "goal", w: 9, h: 1, config: {} },
    ];
    expect(readWidgets(saved).map((w) => w.id)).toEqual(["number"]);
  });
});

describe("widget numbers", () => {
  it("compares a quarter, year or month with the one before, and other spans with as many days", () => {
    expect(previousSpan({ from: "2026-10-01", to: "2026-12-31", label: "This quarter" })).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
      label: "last quarter",
    });
    expect(previousSpan({ from: "2026-01-01", to: "2026-03-31", label: "This quarter" })).toEqual({
      from: "2025-10-01",
      to: "2025-12-31",
      label: "last quarter",
    });
    expect(previousSpan({ from: "2026-01-01", to: "2026-12-31", label: "This year" })?.label).toBe(
      "last year",
    );
    expect(previousSpan({ from: "2026-03-01", to: "2026-03-31", label: "Mar" })).toMatchObject({
      from: "2026-02-01",
      to: "2026-02-28",
      label: "last month",
    });
    expect(
      previousSpan({ from: "2026-10-04", to: "2026-11-02", label: "Last 30 days" }),
    ).toMatchObject({
      from: "2026-09-04",
      to: "2026-10-03",
      label: "the period before",
    });
    expect(previousSpan({ from: null, to: null, label: "All time" })).toBeNull();
    // A quarter still under way: the same number of days into last quarter.
    expect(
      previousSpan({ from: "2026-10-01", to: "2026-12-31", label: "This quarter" }, "2026-11-02"),
    ).toEqual({ from: "2026-07-01", to: "2026-08-02", label: "the same point last quarter" });
  });

  it("totals a number over the span and against the span before", () => {
    const r = computeWidget(
      widget("number", { field: "amount", agg: "sum", date: CREATED }),
      source,
      ctx,
    );
    expect(r).toMatchObject({
      type: "number",
      data: { value: 4750, previous: 0, format: "money" },
    });
  });

  it("counts rows when no number is picked", () => {
    const r = computeWidget(widget("number", { field: null, agg: "count" }), source, ctx);
    expect(r?.type === "number" && r.data.value).toBe(4);
  });

  it("splits by a choice, biggest first, with shares", () => {
    const r = computeWidget(
      widget("breakdown", { group: "tier", field: "amount", agg: "sum" }),
      source,
      ctx,
    );
    if (r?.type !== "breakdown") throw new Error("not a breakdown");
    expect(r.data.rows.map((x) => [x.label, x.value])).toEqual([
      ["Not set", 2500],
      ["Gold", 1500],
      ["Silver", 750],
    ]);
    expect(r.data.total).toBe(4750);
  });

  it("walks the pipeline in the choices' order, counting who reached each stage", () => {
    const r = computeWidget(widget("pipeline", { group: "stage" }), source, ctx);
    if (r?.type !== "pipeline") throw new Error("not a pipeline");
    expect(r.data.stages.map((s) => [s.label, s.count, s.reached])).toEqual([
      ["Contacted", 2, 5],
      ["Talking", 1, 3],
      ["Committed", 1, 2],
      ["Paid", 1, 1],
    ]);
  });

  it("finds rows past their date, leaving the finished ones out", () => {
    const r = computeWidget(
      widget("overdue", { date: "follow", owner: "owner", group: "stage", staleDays: 30 }),
      source,
      ctx,
    );
    if (r?.type !== "overdue") throw new Error("not overdue");
    expect(r.data.overdue.map((x) => [x.title, x.daysLate, x.owner])).toEqual([
      ["Figma", 6, "Lucas Silva"],
    ]);
    // Notion is paid, so its old follow-up doesn't count; the May Figma is stale.
    expect(r.data.stale.map((x) => x.id)).toContain("5");
    expect(r.data.overdue.some((x) => x.id === "3")).toBe(false);
  });

  it("names repeated rows and mostly empty fields in Database health", () => {
    const r = computeWidget(widget("health"), source, ctx);
    if (r?.type !== "health") throw new Error("not health");
    expect(r.data.duplicates).toEqual([{ title: "Figma", count: 2 }]);
    expect(r.data.empty.map((e) => e.field)).toContain("Owner");
  });

  it("buckets by week across the span", () => {
    const r = computeWidget(widget("over-time", { date: CREATED, bucket: "month" }), source, ctx);
    if (r?.type !== "over-time") throw new Error("not over time");
    expect(r.data.points.map((p) => p.label)).toEqual(["Jul", "Aug", "Sep", "Oct", "Nov"]);
    expect(r.data.points.map((p) => p.value)).toEqual([0, 1, 2, 1, 0]);
  });
});

describe("Insights", () => {
  it("leads with what's overdue, then the headline numbers", () => {
    const widgets = [
      widget("insights"),
      { ...widget("number", { field: "amount", agg: "sum", date: CREATED }), id: "total" },
      widget("overdue", { date: "follow", owner: "owner", group: "stage" }),
    ];
    const computed = computeReport(widgets, source, ctx, null);
    const lines = readInsights(computed, ctx.span);
    expect(lines[0]).toMatchObject({ tone: "warn", widgetId: "overdue" });
    expect(lines[0].text).toContain("Figma, 6 days late (Lucas Silva)");
    expect(lines[1].text).toBe("Total amount: $4,750 from Jul 1 – Dec 31, 2026.");
    const insights = computed.find((c) => c.widget.type === "insights");
    expect(insights?.payload).toMatchObject({ type: "insights", data: { byClaude: false } });
  });

  it("shows Claude's saved reading when there is one", () => {
    const saved = {
      lines: [{ text: "Hi", widgetId: null, tone: "info" as const }],
      at: "2026-11-01T00:00:00.000Z",
    };
    const computed = computeReport([widget("insights")], source, ctx, saved);
    expect(computed[0].payload).toMatchObject({ data: { byClaude: true, lines: saved.lines } });
  });
});

describe("filling rows", () => {
  it("widens each row's last widget to the edge and evens its heights", () => {
    const rows = fillRows([
      { id: "a", w: 1, h: 1 },
      { id: "b", w: 2, h: 1 },
      { id: "c", w: 2, h: 2 },
      { id: "d", w: 4, h: null },
      { id: "e", w: 1, h: 2 },
    ]);
    expect(rows.map((r) => [r.id, r.w, r.h])).toEqual([
      ["a", 1, 1],
      ["b", 3, 1],
      ["c", 4, 2],
      ["d", 4, null],
      ["e", 4, 2],
    ]);
  });
});
