import { describe, expect, it } from "vitest";

import { addPosition, type DraftPosition } from "./draft";
import { applyOutline, draftFromMembers, parseOutline, type TitledMember } from "./outline";
import {
  nextEmptySeat,
  normalizeTitle,
  reviewQuestions,
  searchMembers,
  seatOrder,
  seatSuggestions,
} from "./quick";
import { SHAPES, shapeChart } from "./shapes";
import { validateChart } from "./validate";

function drafted(members: TitledMember[]): DraftPosition[] {
  return applyOutline([], parseOutline(draftFromMembers(members)), members);
}

describe("reviewQuestions", () => {
  it("asks about a placement chosen only by a shared word", () => {
    const members = [
      { id: "p", name: "Pat Lee", title: "President" },
      { id: "v", name: "Val Ray", title: "VP Events" },
      { id: "c", name: "Cy Moss", title: "Events coordinator" },
    ];
    const positions = drafted(members);
    const c = positions.find((p) => p.userId === "c")!;
    const v = positions.find((p) => p.userId === "v")!;
    expect(reviewQuestions(positions, members)).toEqual([
      { kind: "placement", positionId: c.id, managerId: v.id },
    ]);
    // Moved somewhere else in the meantime: no longer asked.
    const moved = positions.map((p) => (p.id === c.id ? { ...p, reportsTo: null } : p));
    expect(reviewQuestions(moved, members)).toEqual([]);
  });

  it("asks who an unconfirmed name is, and nothing for a certain chart", () => {
    const members = [
      { id: "p", name: "Pat Lee", title: "President" },
      { id: "s1", name: "Sam Rivera", title: "Treasurer" },
      { id: "s2", name: "Sam Rivera", title: null },
    ];
    const positions = drafted(members);
    const treasurer = positions.find((p) => p.title === "Treasurer")!;
    expect(treasurer.userId).toBeNull();
    expect(reviewQuestions(positions, members)).toEqual([
      { kind: "match", positionId: treasurer.id, userId: treasurer.suggestedUserIds[0] },
    ]);

    const sure = [
      { id: "p", name: "Pat Lee", title: "President" },
      { id: "t", name: "Tia Cho", title: "Treasurer" },
    ];
    expect(reviewQuestions(drafted(sure), sure)).toEqual([]);
  });
});

describe("shapes", () => {
  it("every shape is a valid chart with one top seat and nobody in it", () => {
    for (const shape of SHAPES) {
      const chart = shapeChart(shape.id);
      expect(chart.positions.length).toBeGreaterThan(2);
      expect(chart.positions.filter((p) => p.reportsTo === null && !p.isAdvisor)).toHaveLength(1);
      expect(chart.positions.every((p) => p.personName === null)).toBe(true);
      expect(new Set(chart.positions.map((p) => p.key)).size).toBe(chart.positions.length);
    }
  });

  it("names roles for an organization, not a school", () => {
    const titles = SHAPES.flatMap((s) => shapeChart(s.id).positions.map((p) => p.title)).join(" ");
    expect(titles).not.toMatch(/faculty|club|semester|campus/i);
  });
});

describe("seats", () => {
  const seats = (titles: [string, string | null][]): DraftPosition[] => {
    let out: DraftPosition[] = [];
    const ids = new Map<string, string>();
    for (const [title, parent] of titles) {
      const id = `s-${title}`;
      out = addPosition(out, parent ? (ids.get(parent) ?? null) : null, id).map((p) =>
        p.id === id ? { ...p, title } : p,
      );
      ids.set(title, id);
    }
    return out;
  };

  it("normalizes titles", () => {
    expect(normalizeTitle("VP, Events & Outreach")).toBe("vice president events and outreach");
  });

  it("suggests members whose titles match, exact first, nobody twice", () => {
    const positions = seats([
      ["President", null],
      ["Vice President", "President"],
      ["Treasurer", "President"],
    ]);
    const members = [
      { id: "a", name: "Ana", title: "VP Growth" },
      { id: "b", name: "Ben", title: "Vice President" },
      { id: "t", name: "Tia", title: "Treasurer" },
      { id: "x", name: "Xi", title: null },
    ];
    const s = seatSuggestions(positions, members);
    expect(s.get("s-Vice President")).toBe("b");
    expect(s.get("s-Treasurer")).toBe("t");
    expect(s.has("s-President")).toBe(false);
    // Turned down: the next fit is offered instead.
    expect(
      seatSuggestions(positions, members, new Set(["s-Vice President:b"])).get("s-Vice President"),
    ).toBe("a");
    // Already seated: not offered again.
    const seated = positions.map((p) => (p.id === "s-President" ? { ...p, userId: "b" } : p));
    expect(seatSuggestions(seated, members).get("s-Vice President")).toBe("a");
  });

  it("walks the empty seats in reading order", () => {
    const positions = seats([
      ["Lead", null],
      ["One", "Lead"],
      ["Two", "Lead"],
    ]);
    expect(seatOrder(positions).map((p) => p.title)).toEqual(["Lead", "One", "Two"]);
    const filled = positions.map((p) => (p.title === "One" ? { ...p, personName: "Someone" } : p));
    expect(nextEmptySeat(filled, "s-Lead")?.title).toBe("Two");
    expect(nextEmptySeat(filled, "s-Two")?.title).toBe("Lead");
    expect(nextEmptySeat(filled, null)?.title).toBe("Lead");
  });

  it("finds members by name, unseated first", () => {
    const members = [
      { id: "1", name: "Anthony Jones", title: null },
      { id: "2", name: "Ana Kim", title: null },
      { id: "3", name: "Dan Antal", title: null },
    ];
    expect(searchMembers("an", members, new Set()).map((m) => m.id)).toEqual(["2", "1", "3"]);
    expect(searchMembers("an", members, new Set(["2"])).map((m) => m.id)).toEqual(["1", "3", "2"]);
    expect(searchMembers("  ", members, new Set())).toEqual([]);
  });

  it("an empty seat publishes as an open role", () => {
    const positions = seats([["Lead", null]]).map((p) => ({ ...p, isOpen: true }));
    expect(
      validateChart(positions.map((p) => ({ ...p, key: p.id, reportsTo: p.reportsTo }))),
    ).toEqual([]);
  });
});
