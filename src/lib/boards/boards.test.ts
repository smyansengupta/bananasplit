import { describe, expect, it } from "vitest";

import { OVERVIEW_WIDGETS, overviewWidgetsFor, resolveOverview } from "@/lib/overview/widgets";

import { boardInputSchema, newWidgetId, parseBoard, readHeight, shapeName } from "./index";

describe("boards", () => {
  it("keeps heights as 1 to 3 rows, reads old pixel heights as rows, and keeps 'fit' as null", () => {
    expect(readHeight(null)).toBeNull();
    expect(readHeight(2)).toBe(2);
    expect(readHeight(0)).toBe(1);
    expect(readHeight(520)).toBe(2);
    expect(readHeight(200)).toBe(1);
    expect(readHeight(99_999)).toBe(3);
  });

  it("names every shape", () => {
    expect(shapeName(1, 1)).toBe("Square");
    expect(shapeName(2, 1)).toBe("Rectangle");
    expect(shapeName(2, 2)).toBe("Big square");
    expect(shapeName(4, 1)).toBe("Full rectangle");
    expect(shapeName(2, null)).toBe("Half width");
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
    expect(boardInputSchema.safeParse([{ id: "a", type: "x", w: 2, h: 4 }]).success).toBe(false);
    expect(boardInputSchema.safeParse([{ id: "a", type: "x", w: 2, h: 200 }]).success).toBe(false);
    expect(boardInputSchema.safeParse([{ id: "a", type: "x", w: 2, h: 2 }]).success).toBe(true);
  });

  it("names a second copy of a widget apart from the first", () => {
    expect(newWidgetId("notes", [{ id: "notes" }])).toBe("notes-2");
  });
});

describe("overview widgets", () => {
  it("never offers anything about the organization's money", () => {
    const text = OVERVIEW_WIDGETS.map((w) => `${w.type} ${w.title} ${w.description}`)
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/balance|finance|budget|money|owed/);
  });

  it("drops what now always heads the page from a saved board", () => {
    const saved = [
      { id: "up-next", type: "up-next", w: 4, h: null },
      { id: "getting-started", type: "getting-started", w: 4, h: null },
      { id: "task-stats", type: "task-stats", w: 1, h: null },
      { id: "pinned", type: "pinned", w: 2, h: null },
    ];
    expect(resolveOverview(saved, true)).toEqual([{ id: "pinned", type: "pinned", w: 2, h: null }]);
    const offered = overviewWidgetsFor(true).map((w) => w.type);
    expect(offered).not.toContain("up-next");
    expect(offered).not.toContain("getting-started");
  });

  it("starts everyone on the slimmer default, a board of shapes", () => {
    expect(resolveOverview(null, false).map((w) => `${w.type}:${w.w}x${w.h ?? "fit"}`)).toEqual([
      "since-you-were-here:2x1",
      "my-tasks:2x2",
      "deadlines:2x1",
      "here-now:1x1",
      "focus-time:1x1",
      "meetings:2x1",
      "week:4xfit",
      "events:2x1",
      "polls:1x1",
      "votes:1x1",
      "weekly-pulse:4xfit",
    ]);
    // The cells add up to whole rows of four (a widget that fits counts as one row).
    expect(resolveOverview(null, false).reduce((n, w) => n + w.w * (w.h ?? 1), 0) % 4).toBe(0);
  });

  it("offers what left the default in Add widget, and the week's recap nowhere", () => {
    const placed = resolveOverview(null, false).map((w) => w.type);
    const offered = overviewWidgetsFor(false).map((w) => w.type);
    for (const type of [
      "pinned",
      "recent",
      "decisions",
      "who-owns-what",
      "quick-capture",
      "waiting-on-you",
    ]) {
      expect(placed).not.toContain(type);
      expect(offered).toContain(type);
    }
    expect(offered).not.toContain("recap");
    expect(resolveOverview([{ id: "recap", type: "recap", w: 4, h: null }], true)).toEqual([]);
  });

  it("offers Waiting on others without placing it", () => {
    expect(overviewWidgetsFor(false).map((w) => w.type)).toContain("waiting-on-others");
    expect(resolveOverview(null, false).map((w) => w.type)).not.toContain("waiting-on-others");
  });

  it("drops the widgets that left Home from a saved board", () => {
    const saved = [
      { id: "rsvp-goal", type: "rsvp-goal", w: 1, h: null },
      { id: "notes", type: "notes", w: 2, h: null },
      { id: "files", type: "files", w: 2, h: null },
      { id: "people", type: "people", w: 1, h: null },
      { id: "recent", type: "recent", w: 2, h: null },
    ];
    expect(resolveOverview(saved, true)).toEqual([{ id: "recent", type: "recent", w: 2, h: null }]);
    const offered = overviewWidgetsFor(true).map((w) => w.type);
    for (const gone of ["rsvp-goal", "notes", "files", "people"])
      expect(offered).not.toContain(gone);
    expect(OVERVIEW_WIDGETS.find((w) => w.type === "recent")?.title).toBe(
      "Pick up where you left off",
    );
  });
});
