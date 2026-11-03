import { describe, expect, it } from "vitest";

import { diffCharts, type DiffPosition } from "./diff";
import { describeChanges, highestTitles, titleChanges, type TitleRow } from "./publish";

const D = (key: string, over: Partial<DiffPosition> = {}): DiffPosition => ({
  key,
  title: key,
  reportsToKey: null,
  userId: null,
  personLabel: "Open hire",
  personName: null,
  isOpen: true,
  isAdvisor: false,
  responsibilities: [],
  decidesAlone: [],
  ...over,
});

const held = (name: string, userId: string) => ({
  userId,
  personLabel: name,
  personName: name,
  isOpen: false,
});

describe("describeChanges", () => {
  it("says each change as a sentence", () => {
    const before = [
      D("president", { title: "President", ...held("Jackson", "jl") }),
      D("growth", { title: "VP Growth", reportsToKey: "president", ...held("Lucas", "ls") }),
      D("ops", { title: "VP Ops", reportsToKey: "president", ...held("Oliver", "ow") }),
      D("tech", { title: "Head of Tech", reportsToKey: "growth", ...held("Smyan", "ss") }),
      D("finance", { title: "Head of Finance", reportsToKey: "president" }),
      D("social", { title: "Head of Social", reportsToKey: "growth", ...held("Kristine", "km") }),
    ];
    const after = [
      ...before.filter((p) => !["tech", "finance", "social"].includes(p.key)),
      D("tech", { title: "Head of Tech", reportsToKey: "ops", ...held("Smyan", "ss") }),
      D("finance", {
        title: "Head of Finance",
        reportsToKey: "president",
        ...held("Anthony", "aj"),
      }),
      D("social", {
        title: "Head of Social and Membership",
        reportsToKey: "growth",
        ...held("Kristine", "km"),
      }),
      D("designer", { title: "Graphic Designer", reportsToKey: "growth" }),
    ];
    const lines = describeChanges(diffCharts(before, after), after, [
      {
        userId: "km",
        name: "Kristine",
        from: "Head of Social",
        to: "Head of Social and Membership",
      },
    ]);
    const said = lines.map((l) => [l.kind, `${l.title} ${l.text}`, l.detail]);
    expect(said).toEqual([
      ["open", "Graphic Designer is a new open role", "Reports to VP Growth"],
      [
        "renamed",
        "Head of Social is now Head of Social and Membership",
        "Kristine's title changes on their profile too",
      ],
      ["moved", "Head of Tech moves under VP Ops", "Was under VP Growth"],
      ["filled", "Head of Finance is filled", "Anthony, was an open role"],
    ]);
    expect(lines.find((l) => l.kind === "filled")?.userId).toBe("aj");
  });
});

describe("titles", () => {
  const rows: TitleRow[] = [
    {
      id: "a",
      userId: "u1",
      reportsToId: null,
      title: "President",
      rank: "a0",
      matchState: "CONFIRMED",
    },
    {
      id: "b",
      userId: "u1",
      reportsToId: "a",
      title: "Treasurer",
      rank: "a0",
      matchState: "CONFIRMED",
    },
    { id: "c", userId: "u2", reportsToId: "a", title: "VP", rank: "a1", matchState: "CONFIRMED" },
    {
      id: "d",
      userId: "u3",
      reportsToId: "a",
      title: "Secretary",
      rank: "a2",
      matchState: "SUGGESTED",
    },
  ];

  it("takes each linked member's highest position", () => {
    expect(Object.fromEntries(highestTitles(rows))).toEqual({ u1: "President", u2: "VP" });
  });

  it("lists only the members whose title would change", () => {
    const members = [
      { id: "u1", name: "Ana", title: "President" },
      { id: "u2", name: "Bo", title: null },
      { id: "u3", name: "Cy", title: "Member" },
    ];
    expect(titleChanges(rows, members)).toEqual([
      { userId: "u2", name: "Bo", from: null, to: "VP" },
    ]);
  });
});
