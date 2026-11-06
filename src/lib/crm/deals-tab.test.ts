// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { FieldDef } from "@/lib/databases/fields";

import {
  dealAmbient,
  dealTypeChoices,
  dealTypeField,
  dealTypeOf,
  groupByStage,
  nextOpenStage,
  nextStepLine,
  parseDealsFilters,
  stageTone,
  type DealForAmbient,
} from "./deals-tab";

const NOW = new Date("2026-11-03T15:00:00Z");
const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe("the Deals tab's URL", () => {
  it("reads list, open, anyone by default", () => {
    expect(parseDealsFilters({})).toEqual({
      view: "list",
      pipeline: null,
      stage: null,
      owner: null,
      type: null,
      show: "open",
      q: null,
    });
  });

  it("reads every filter and drops what it can't use", () => {
    expect(
      parseDealsFilters({ view: "board", pipeline: "p_1", owner: "me", type: "Renewal", show: "won", q: " grove " }),
    ).toEqual({ view: "board", pipeline: "p_1", stage: null, owner: "me", type: "renewal", show: "won", q: "grove" });
    expect(parseDealsFilters({ view: "table", pipeline: "a b", owner: "<x>", show: "maybe" })).toMatchObject({
      view: "list",
      pipeline: null,
      owner: null,
      show: "open",
    });
    expect(parseDealsFilters({ show: ["lost", "won"] }).show).toBe("lost");
  });
});

describe("a deal's type", () => {
  const field: FieldDef = {
    id: "f1",
    name: "Type",
    type: "SELECT",
    isPrimary: false,
    options: {
      choices: [
        { id: "c1", label: "New", color: "blue" },
        { id: "c2", label: "Renewal", color: "yellow" },
      ],
    },
  };

  it("is the single select named Type", () => {
    expect(dealTypeField([{ ...field, name: "Tier" }])).toBeNull();
    expect(dealTypeField([{ ...field, type: "TEXT" }])).toBeNull();
    expect(dealTypeField([{ ...field, name: " type " }])?.id).toBe("f1");
  });

  it("reads the picked choice", () => {
    expect(dealTypeOf(field, { f1: "c2" })).toEqual({ id: "c2", label: "Renewal", color: "yellow" });
    expect(dealTypeOf(field, { f1: "gone" })).toBeNull();
    expect(dealTypeOf(field, {})).toBeNull();
    expect(dealTypeOf(null, { f1: "c2" })).toBeNull();
  });

  it("offers the ready-made four until the field exists", () => {
    expect(dealTypeChoices(null).map((c) => c.label)).toEqual(["New", "Renewal", "Partnership", "Grant"]);
    expect(dealTypeChoices(field).map((c) => c.label)).toEqual(["New", "Renewal"]);
  });
});

describe("a deal row's ambient buttons", () => {
  const base: DealForAmbient = {
    closed: false,
    nextStep: "Send the deck",
    nextStepAt: day("2026-11-06"),
    stageEnteredAt: day("2026-10-30"),
    stageName: "Talking",
    stuckAfterDays: 14,
    nextStage: { id: "s3", name: "Proposal sent" },
  };

  it("asks nothing of a deal that's on track or closed", () => {
    expect(dealAmbient(base, NOW)).toBeNull();
    expect(dealAmbient({ ...base, closed: true, nextStep: null }, NOW)).toBeNull();
  });

  it("offers Follow up and Push for a late next step", () => {
    const a = dealAmbient({ ...base, nextStepAt: day("2026-11-01") }, NOW)!;
    expect(a.why).toBe("Next step 2 days late");
    expect(a.actions.map((x) => x.label)).toEqual(["Follow up", "Push"]);
    expect(dealAmbient({ ...base, nextStepAt: day("2026-11-02") }, NOW)!.why).toBe("Next step a day late");
  });

  it("offers Add a next step when there's none", () => {
    const a = dealAmbient({ ...base, nextStep: "  ", nextStepAt: null }, NOW)!;
    expect(a).toEqual({ why: "No next step", actions: [{ kind: "add-step", label: "Add a next step", tone: "outline" }] });
  });

  it("offers Next stage past the stage's limit, only to an open stage", () => {
    const stuck = { ...base, stageEnteredAt: day("2026-10-01") };
    expect(dealAmbient(stuck, NOW)).toEqual({
      why: "33 days in Talking",
      actions: [{ kind: "next-stage", label: "Next stage", tone: "solid" }],
    });
    expect(dealAmbient({ ...stuck, nextStage: null }, NOW)).toBeNull();
    expect(dealAmbient({ ...stuck, stuckAfterDays: null }, NOW)).toBeNull();
  });

  it("never offers more than two", () => {
    for (const d of [base, { ...base, nextStep: null }, { ...base, nextStepAt: day("2026-01-01") }]) {
      expect((dealAmbient(d, NOW)?.actions.length ?? 0) <= 2).toBe(true);
    }
  });
});

describe("stages", () => {
  const stages = [
    { id: "a", kind: "OPEN" },
    { id: "b", kind: "OPEN" },
    { id: "w", kind: "WON" },
  ];
  it("finds the next open stage, never a closing one", () => {
    expect(nextOpenStage(stages, "a")?.id).toBe("b");
    expect(nextOpenStage(stages, "b")).toBeNull();
    expect(nextOpenStage(stages, "x")).toBeNull();
  });

  it("groups rows in stage order, with counts and sums, leaving empty stages out", () => {
    const s = (id: string, kind: "OPEN" | "WON" | "LOST" = "OPEN") => ({ id, name: id, kind, pipelineId: "p", pipelineName: "Deals" });
    const groups = groupByStage(
      [s("a"), s("b"), s("w", "WON")],
      [
        { stageId: "w", amountCents: 500 },
        { stageId: "a", amountCents: 100 },
        { stageId: "a", amountCents: null },
      ],
    );
    expect(groups.map((g) => [g.stage.id, g.count, g.sumCents])).toEqual([
      ["a", 2, 100],
      ["w", 1, 500],
    ]);
  });

  it("colours Won green and Lost red", () => {
    expect(stageTone("WON", 0)).toBe("var(--chart-3)");
    expect(stageTone("LOST", 3)).toBe("var(--destructive)");
    expect(stageTone("OPEN", 1)).toBe("var(--chart-1)");
  });

  it("writes a next step with its day", () => {
    expect(nextStepLine("Intro email", day("2026-11-05"))).toBe("Intro email, Nov 5");
    expect(nextStepLine("Intro email", null)).toBe("Intro email");
    expect(nextStepLine(null, null)).toBe("No next step");
  });
});
