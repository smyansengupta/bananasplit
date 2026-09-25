import { describe, expect, it } from "vitest";

import {
  addPosition,
  canDrop,
  confirmAllExact,
  exactMatches,
  moveDraft,
  moveSibling,
  removePosition,
  setManager,
  siblingsOf,
  unlinkMember,
  type DraftPosition,
} from "./draft";

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

const chart = [
  P("pres", null, "a0"),
  P("adv", "pres", "a0", { isAdvisor: true }),
  P("ops", "pres", "a1"),
  P("growth", "pres", "a2"),
  P("tech", "ops", "a0"),
  P("prog", "ops", "a1"),
];
const order = (list: DraftPosition[], parent: string | null) => siblingsOf(list, parent).map((p) => p.id);

describe("draft operations", () => {
  it("reparents by dropping inside a row, as its last report", () => {
    const moved = moveDraft(chart, "tech", "growth", "inside")!;
    expect(moved.find((p) => p.id === "tech")?.reportsTo).toBe("growth");
    expect(order(moved, "ops")).toEqual(["prog"]);
  });

  it("reorders by dropping before or after a sibling, across managers too", () => {
    expect(order(moveDraft(chart, "prog", "tech", "before")!, "ops")).toEqual(["prog", "tech"]);
    const across = moveDraft(chart, "tech", "growth", "after")!;
    expect(order(across, "pres")).toEqual(["adv", "ops", "growth", "tech"]);
  });

  it("refuses a drop onto itself, a descendant, or inside an advisor", () => {
    expect(canDrop(chart, "ops", "ops", "inside")).toBe(false);
    expect(canDrop(chart, "ops", "tech", "inside")).toBe(false);
    expect(canDrop(chart, "pres", "prog", "after")).toBe(false);
    expect(canDrop(chart, "tech", "adv", "inside")).toBe(false);
    expect(canDrop(chart, "tech", "adv", "after")).toBe(true);
    expect(moveDraft(chart, "ops", "tech", "inside")).toBeNull();
  });

  it("sets a manager from the picker and refuses a loop", () => {
    expect(setManager(chart, "prog", "growth")!.find((p) => p.id === "prog")?.reportsTo).toBe("growth");
    expect(setManager(chart, "ops", "tech")).toBeNull();
    expect(setManager(chart, "tech", null)!.find((p) => p.id === "tech")?.reportsTo).toBeNull();
  });

  it("moves up and down among siblings", () => {
    expect(order(moveSibling(chart, "growth", -1), "pres")).toEqual(["adv", "growth", "ops"]);
    expect(order(moveSibling(chart, "tech", 1), "ops")).toEqual(["prog", "tech"]);
    expect(order(moveSibling(chart, "tech", -1), "ops")).toEqual(["tech", "prog"]);
  });

  it("adds a position last under its manager, and removing one lifts its reports", () => {
    const added = addPosition(chart, "ops", "new-1");
    expect(order(added, "ops")).toEqual(["tech", "prog", "new-1"]);
    const removed = removePosition(chart, "ops");
    expect(removed.find((p) => p.id === "tech")?.reportsTo).toBe("pres");
    expect(removed.some((p) => p.id === "ops")).toBe(false);
  });

  it("confirms exact matches only, and unlinking keeps the placeholder name", () => {
    const list = [
      P("a", null, "a0", { personName: "Jackson Lamoureux", matchState: "SUGGESTED", matchScore: 1, suggestedUserIds: ["u1"] }),
      P("b", "a", "a0", { personName: "Oliver", matchState: "SUGGESTED", matchScore: 0.85, suggestedUserIds: ["u2"] }),
    ];
    expect(exactMatches(list).map((p) => p.id)).toEqual(["a"]);
    const confirmed = confirmAllExact(list, new Map([["u1", "Jackson Lamoureux"]]));
    expect(confirmed[0]).toMatchObject({ userId: "u1", matchState: "CONFIRMED" });
    expect(confirmed[1]).toMatchObject({ userId: null, matchState: "SUGGESTED" });
    expect(unlinkMember(confirmed[0])).toMatchObject({
      userId: null,
      matchState: "SUGGESTED",
      personName: "Jackson Lamoureux",
    });
  });
});
