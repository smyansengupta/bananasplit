// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  callWasTalk,
  funnelOf,
  groupIssuesExactly,
  isConvertedRelationship,
  issueKey,
  mergeIssueGroups,
  readIssue,
} from "./report-classics";

describe("people talked to", () => {
  it("counts a call only when someone picked up", () => {
    expect(callWasTalk("connected")).toBe(true);
    expect(callWasTalk("not-interested")).toBe(true);
    expect(callWasTalk(null)).toBe(true);
    expect(callWasTalk("voicemail")).toBe(false);
    expect(callWasTalk("no-answer")).toBe(false);
    expect(callWasTalk("busy")).toBe(false);
  });
});

describe("converted", () => {
  it("knows which relationships mean someone came on board", () => {
    expect(isConvertedRelationship({ id: "member", label: "Member" })).toBe(true);
    expect(isConvertedRelationship({ id: "client", label: "Client" })).toBe(true);
    expect(isConvertedRelationship({ id: "partner", label: "Partner" })).toBe(true);
    expect(isConvertedRelationship({ id: "x1", label: "Customers" })).toBe(true);
    expect(isConvertedRelationship({ id: "prospect", label: "Prospective member" })).toBe(false);
    expect(isConvertedRelationship({ id: "press", label: "Press" })).toBe(false);
  });

  it("nests the funnel: a converted person counts as interested", () => {
    const f = funnelOf(["a", "b", "c", "d", "a"], new Set(["b", "x"]), new Set(["c", "y"]));
    expect(f).toEqual({ talked: 4, interested: 2, converted: 1 });
  });

  it("has nobody past nobody", () => {
    expect(funnelOf([], new Set(["a"]), new Set(["a"]))).toEqual({ talked: 0, interested: 0, converted: 0 });
  });
});

describe("top issues", () => {
  it("reads the issue off the enrichment, and nothing from old data", () => {
    expect(readIssue({ _issue: { text: " Budget is tight ", at: "2026-10-01T00:00:00Z", model: null, sources: [] } })).toEqual({
      text: "Budget is tight",
      at: "2026-10-01T00:00:00Z",
    });
    expect(readIssue({})).toBeNull();
    expect(readIssue({ _issue: { text: "  " } })).toBeNull();
    expect(readIssue(null)).toBeNull();
    expect(readIssue({ _issue: "Budget" })).toBeNull();
  });

  it("treats case, spaces and a trailing period as the same issue", () => {
    expect(issueKey("Budget  is tight.")).toBe(issueKey("budget is tight"));
  });

  it("groups by exact text, the biggest first, named as most wrote it", () => {
    const groups = groupIssuesExactly([
      { id: "1", name: "Ada", issue: "Budget is tight" },
      { id: "2", name: "Ben", issue: "budget is tight." },
      { id: "3", name: "Cy", issue: "Budget is tight" },
      { id: "4", name: "Di", issue: "No time to volunteer" },
    ]);
    expect(groups.map((g) => [g.label, g.people.length])).toEqual([
      ["Budget is tight", 3],
      ["No time to volunteer", 1],
    ]);
  });

  it("merges groups the AI says mean the same, keeping the rest", () => {
    const exact = [
      { label: "Budget is tight", people: [{ id: "1", name: "Ada" }] },
      { label: "Not enough money", people: [{ id: "2", name: "Ben" }, { id: "1", name: "Ada" }] },
      { label: "No time", people: [{ id: "3", name: "Cy" }] },
    ];
    const merged = mergeIssueGroups(exact, [
      { label: "Money", members: [0, 1, 9] },
      { label: "Twice", members: [1] },
    ]);
    expect(merged.map((g) => [g.label, g.people.map((p) => p.id)])).toEqual([
      ["Money", ["1", "2"]],
      ["No time", ["3"]],
    ]);
  });
});
