import { describe, expect, it } from "vitest";

import { OVERVIEW_WIDGETS, overviewWidgetsFor, resolveOverview } from "@/lib/overview/widgets";

import { boardInputSchema, clampHeight, newWidgetId, parseBoard } from "./index";

describe("boards", () => {
  it("snaps heights to 20px within bounds, and keeps 'fit' as null", () => {
    expect(clampHeight(null)).toBeNull();
    expect(clampHeight(251)).toBe(260);
    expect(clampHeight(10)).toBe(120);
    expect(clampHeight(99_999)).toBe(1200);
  });

  it("drops unknown types and duplicate ids from a saved board", () => {
    expect(
      parseBoard(
        [
          { id: "a", type: "x", w: 2, h: null },
          { id: "a", type: "x", w: 1, h: null },
          { id: "b", type: "gone", w: 1, h: null },
        ],
        ["x"],
      ),
    ).toEqual([{ id: "a", type: "x", w: 2, h: null }]);
    expect(parseBoard("nope", ["x"])).toBeNull();
  });

  it("accepts only well-formed layouts for saving", () => {
    expect(boardInputSchema.safeParse([{ id: "a", type: "x", w: 5, h: null }]).success).toBe(false);
    expect(boardInputSchema.safeParse([{ id: "a", type: "x", w: 2, h: 60 }]).success).toBe(false);
    expect(boardInputSchema.safeParse([{ id: "a", type: "x", w: 2, h: 200 }]).success).toBe(true);
  });

  it("names a second copy of a widget apart from the first", () => {
    expect(newWidgetId("notes", [{ id: "notes" }])).toBe("notes-2");
  });
});

describe("overview widgets", () => {
  it("never offers anything about the club's money", () => {
    const text = OVERVIEW_WIDGETS.map((w) => `${w.type} ${w.title} ${w.description}`).join(" ").toLowerCase();
    expect(text).not.toMatch(/balance|finance|budget|money|owed/);
  });

  it("keeps admin widgets to admins, even on a saved board", () => {
    expect(overviewWidgetsFor(false).map((w) => w.type)).not.toContain("getting-started");
    const saved = [{ id: "getting-started", type: "getting-started", w: 4, h: null }];
    expect(resolveOverview(saved, false)).toEqual([]);
    expect(resolveOverview(saved, true)).toEqual(saved);
    expect(resolveOverview(null, false).map((w) => w.type)).toContain("pinned");
  });
});
