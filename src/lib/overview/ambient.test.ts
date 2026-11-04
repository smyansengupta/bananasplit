import { describe, expect, it } from "vitest";

import type { BoardWidget } from "@/lib/boards";

import { BAND_COLUMNS, ambientLayout, bandOf } from "./ambient";
import { resolveOverview } from "./widgets";

const none = { resting: new Set<string>(), compact: new Set<string>() };
const spans = (rows: ReturnType<typeof ambientLayout>["rows"]) =>
  rows.map((r) => r.items.map((i) => `${i.widget.type}:${i.span}`).join(" "));

describe("ambientLayout", () => {
  const home = resolveOverview(null, true);

  it("lays the default Home out in five bands, each adding up to eight columns", () => {
    const { rows, resting } = ambientLayout(home, none);
    expect(resting).toEqual([]);
    expect(spans(rows)).toEqual([
      "my-tasks:4 since-you-were-here:4",
      "here-now:2 meetings:2 polls:2 votes:2",
      "deadlines:4 events:4",
      "week:8",
      "weekly-pulse:8",
    ]);
    for (const r of rows) expect(r.items.reduce((n, i) => n + i.span, 0)).toBe(BAND_COLUMNS);
  });

  it("keeps each widget's spot whatever order the board was saved in", () => {
    const shuffled = [...home].reverse();
    expect(spans(ambientLayout(shuffled, none).rows)).toEqual(
      spans(ambientLayout(home, none).rows),
    );
  });

  it("gives a resting widget's columns to its neighbours and moves nothing else", () => {
    const { rows, resting } = ambientLayout(home, {
      resting: new Set(["since-you-were-here", "votes"]),
      compact: new Set(["here-now"]),
    });
    expect(resting.map((w) => w.type)).toEqual(["since-you-were-here", "votes"]);
    expect(spans(rows)).toEqual([
      "my-tasks:8",
      "here-now:1 meetings:4 polls:3",
      "deadlines:4 events:4",
      "week:8",
      "weekly-pulse:8",
    ]);
  });

  it("sits Focus time beside the week, and never widens it", () => {
    const personal = resolveOverview(null, false, null, true);
    const { rows } = ambientLayout(personal, {
      resting: new Set(["my-tasks", "deadlines", "meetings", "events", "polls", "recent"]),
      compact: new Set(),
    });
    expect(spans(rows)).toContain("week:6 focus-time:2");
    const alone = ambientLayout(personal, {
      resting: new Set(personal.filter((w) => w.type !== "focus-time").map((w) => w.type)),
      compact: new Set(),
    });
    expect(spans(alone.rows)).toEqual(["focus-time:2"]);
  });

  it("drops a band that has nothing left in it", () => {
    const only: BoardWidget[] = [
      { id: "votes", type: "votes", w: 1, h: 1 },
      { id: "week", type: "week", w: 4, h: null },
    ];
    const { rows } = ambientLayout(only, { resting: new Set(["votes"]), compact: new Set() });
    expect(spans(rows)).toEqual(["week:8"]);
  });

  it("puts an added widget in its own band, and wraps a full band onto a second row", () => {
    const more: BoardWidget[] = [
      ...home,
      { id: "waiting-on-you", type: "waiting-on-you", w: 2, h: 1 },
      { id: "decisions", type: "decisions", w: 2, h: 1 },
    ];
    expect(spans(ambientLayout(more, none).rows)).toEqual([
      "my-tasks:4 since-you-were-here:4",
      "waiting-on-you:8",
      "here-now:2 meetings:2 polls:2 votes:2",
      "deadlines:4 events:4",
      "week:8",
      "weekly-pulse:8",
      "decisions:8",
    ]);
  });

  it("brings what your role is for into You, right after My tasks", () => {
    const more: BoardWidget[] = [...home, { id: "decisions", type: "decisions", w: 2, h: 1 }];
    const { rows } = ambientLayout(more, {
      resting: new Set(),
      compact: new Set(),
      promoted: new Set(["decisions"]),
    });
    expect(spans(rows).slice(0, 2)).toEqual(["my-tasks:4 decisions:4", "since-you-were-here:8"]);
    expect(spans(rows)).not.toContain("decisions:8");
  });

  it("sends a type it doesn't know to Organization", () => {
    expect(bandOf("something-new")).toBe("organization");
  });
});
