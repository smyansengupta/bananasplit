import { describe, expect, it } from "vitest";

import type { DraftPosition } from "./draft";
import {
  approvePlacement,
  bestGuess,
  choosablePositions,
  declinePlacement,
  isPlacementMarker,
  placeSelf,
  placementOf,
  placementSummary,
  visibleQuotes,
} from "./self-place";

const P = (
  id: string,
  reportsTo: string | null,
  rank: string,
  over: Partial<DraftPosition> = {},
): DraftPosition => ({
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
  P("pres", null, "a0", {
    title: "President",
    userId: "jl",
    personName: "Jackson",
    matchState: "CONFIRMED",
  }),
  P("growth", "pres", "a1", {
    title: "VP Growth",
    userId: "ls",
    personName: "Lucas",
    matchState: "CONFIRMED",
  }),
  P("design", "growth", "a0", { title: "Graphic Designer", isOpen: true }),
  P("finance", "pres", "a2", { title: "Head of Finance" }),
];
const priya = { id: "pr", name: "Priya Raman", title: "Graphic Designer" };

describe("self-placement", () => {
  it("offers only free positions and your own, and guesses from your title", () => {
    expect(choosablePositions(chart, "pr").map((p) => p.id)).toEqual(["design", "finance"]);
    expect(choosablePositions(chart, "ls").map((p) => p.id)).toEqual([
      "growth",
      "design",
      "finance",
    ]);
    expect(bestGuess(chart, priya)?.id).toBe("design");
    expect(bestGuess(chart, { id: "ls", title: "Something" })?.id).toBe("growth");
    expect(bestGuess(chart, { id: "x", title: "Chef" })).toBeNull();
  });

  it("waits for approval in the picked position, then counts as placed", () => {
    const next = placeSelf(chart, priya, { positionId: "design" })!;
    const design = next.find((p) => p.id === "design")!;
    expect(design).toMatchObject({
      isOpen: false,
      userId: null,
      personName: "Priya Raman",
      matchState: "SUGGESTED",
      suggestedUserIds: ["pr"],
    });
    expect(placementOf(design)).toEqual({ userId: "pr", added: false });
    const summary = placementSummary(next);
    expect([...summary.placed]).toEqual(["pr"]);
    expect(summary.pending.map((x) => x.position.id)).toEqual(["design"]);

    const approved = approvePlacement(next, "design", "Priya Raman")!;
    expect(approved.find((p) => p.id === "design")).toMatchObject({
      userId: "pr",
      matchState: "CONFIRMED",
    });
    expect(placementSummary(approved).pending).toEqual([]);
    expect([...placementSummary(approved).placed]).toEqual(["pr"]);
  });

  it("confirming the position you hold needs no approval", () => {
    const next = placeSelf(chart, { id: "ls", name: "Lucas" }, { positionId: "growth" })!;
    expect(next.find((p) => p.id === "growth")).toMatchObject({
      userId: "ls",
      matchState: "CONFIRMED",
    });
    expect(placementSummary(next).pending).toEqual([]);
    expect(placementSummary(next).placed.has("ls")).toBe(true);
  });

  it("refuses a position someone else holds or asked for", () => {
    expect(placeSelf(chart, priya, { positionId: "growth" })).toBeNull();
    const taken = placeSelf(chart, priya, { positionId: "finance" })!;
    expect(placeSelf(taken, { id: "dp", name: "Dev" }, { positionId: "finance" })).toBeNull();
  });

  it("adds a role that isn't on the chart, and moving leaves the old one open", () => {
    const added = placeSelf(
      chart,
      { id: "dp", name: "Dev Patel" },
      { title: "Events Lead", managerId: "growth" },
      "new-1",
    )!;
    const role = added.find((p) => p.id === "new-1")!;
    expect(role).toMatchObject({
      title: "Events Lead",
      reportsTo: "growth",
      suggestedUserIds: ["dp"],
    });
    expect(placementOf(role)).toEqual({ userId: "dp", added: true });

    // Changing their mind: the role they added goes with them.
    const moved = placeSelf(added, { id: "dp", name: "Dev Patel" }, { positionId: "finance" })!;
    expect(moved.some((p) => p.id === "new-1")).toBe(false);

    // Lucas says he is Head of Finance: VP Growth opens up.
    const lucas = placeSelf(chart, { id: "ls", name: "Lucas" }, { positionId: "finance" })!;
    expect(lucas.find((p) => p.id === "growth")).toMatchObject({
      isOpen: true,
      userId: null,
      personName: null,
    });
  });

  it("declining puts the position back, or drops an added role", () => {
    const next = placeSelf(chart, priya, { positionId: "finance" })!;
    expect(declinePlacement(next, "finance")!.find((p) => p.id === "finance")).toMatchObject({
      isOpen: true,
      personName: null,
      sourceQuote: [],
    });
    const added = placeSelf(chart, priya, { title: "Designer", managerId: null }, "new-2")!;
    expect(declinePlacement(added, "new-2")!.some((p) => p.id === "new-2")).toBe(false);
    expect(declinePlacement(chart, "pres")).toBeNull();
  });

  it("keeps the markers out of the quotes shown to people", () => {
    expect(isPlacementMarker("self-placed:u1")).toBe(true);
    expect(visibleQuotes(["President: Jackson", "self-added:u1"])).toEqual(["President: Jackson"]);
  });
});
