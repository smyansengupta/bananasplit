import { describe, expect, it } from "vitest";

import { canSettle, cleanDecision, cleanOutcome, QUESTION_MAX, standings } from "./rules";

describe("canSettle", () => {
  const member = { userId: "u_me", role: "MEMBER" as const };

  it("one nobody owns is its raiser's or an admin's; anyone else takes it first", () => {
    expect(canSettle(member, { ownerId: null, createdById: "u_other" })).toBe(false);
    expect(canSettle(member, { ownerId: null, createdById: "u_me" })).toBe(true);
    expect(canSettle(member, { ownerId: null, createdById: null })).toBe(false);
    expect(
      canSettle({ userId: "u_me", role: "ADMIN" }, { ownerId: null, createdById: "u_other" }),
    ).toBe(true);
  });

  it("an owned one is its owner's, its raiser's, or an owner's or admin's", () => {
    expect(canSettle(member, { ownerId: "u_me", createdById: "u_other" })).toBe(true);
    expect(canSettle(member, { ownerId: "u_other", createdById: "u_me" })).toBe(true);
    expect(canSettle(member, { ownerId: "u_other", createdById: "u_third" })).toBe(false);
    expect(
      canSettle({ userId: "u_me", role: "TREASURER" }, { ownerId: "u_other", createdById: null }),
    ).toBe(false);
    expect(
      canSettle({ userId: "u_me", role: "ADMIN" }, { ownerId: "u_other", createdById: null }),
    ).toBe(true);
    expect(
      canSettle({ userId: "u_me", role: "OWNER" }, { ownerId: "u_other", createdById: null }),
    ).toBe(true);
  });
});

describe("cleanDecision and cleanOutcome", () => {
  it("keeps the question to one line and the detail optional", () => {
    expect(cleanDecision({ question: " Move workshops\n to Wednesdays? " })).toEqual({
      ok: true,
      question: "Move workshops to Wednesdays?",
      detail: null,
    });
    expect(cleanDecision({ question: "T-shirt vendor", detail: "  Two quotes in  " })).toEqual({
      ok: true,
      question: "T-shirt vendor",
      detail: "Two quotes in",
    });
  });

  it("refuses an empty or overlong question, and an empty outcome", () => {
    expect(cleanDecision({ question: "  " })).toMatchObject({ ok: false });
    expect(cleanDecision({ question: "x".repeat(QUESTION_MAX + 1) })).toMatchObject({ ok: false });
    expect(cleanOutcome("  ")).toEqual({ ok: false, error: "Say what was decided." });
    expect(cleanOutcome(" Dec  5 ")).toEqual({ ok: true, outcome: "Dec 5" });
  });
});

describe("standings", () => {
  const options = [
    { id: "o1", label: "Nov 21" },
    { id: "o2", label: "Dec 5" },
    { id: "o3", label: "Dec 12" },
  ];

  it("puts the leader first and gives each a share of the voters", () => {
    expect(
      standings(
        options,
        [
          { optionId: "o1", votes: 3 },
          { optionId: "o2", votes: 4 },
        ],
        7,
      ),
    ).toEqual([
      { label: "Dec 5", votes: 4, pct: 57 },
      { label: "Nov 21", votes: 3, pct: 43 },
      { label: "Dec 12", votes: 0, pct: 0 },
    ]);
  });

  it("keeps the poll's order before anyone votes", () => {
    expect(standings(options, [], 0).map((s) => s.label)).toEqual(["Nov 21", "Dec 5", "Dec 12"]);
  });
});
