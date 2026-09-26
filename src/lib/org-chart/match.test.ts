import { describe, expect, it } from "vitest";

import { isExactMatch, jaroWinkler, matchPerson, normalizeName, type MatchCandidate } from "./match";

const members: MatchCandidate[] = [
  { userId: "jackson", name: "Jackson Lamoureux", emailLocal: "jackson" },
  { userId: "mehr", name: "Mehr Anand", emailLocal: "mehr" },
  { userId: "oliver", name: "Oliver Ward", emailLocal: "oliver" },
  { userId: "lucas", name: "Lucas Salzgeber", emailLocal: "lucas" },
  { userId: "anthony", name: "Anthony Jones", emailLocal: "anthony" },
  { userId: "alex", name: "Alex Green", emailLocal: "alex" },
  { userId: "smyan", name: "Smyan Sengupta", emailLocal: "smyan" },
  { userId: "kristine", name: "Kristine Min", emailLocal: "kristine" },
];

describe("matchPerson", () => {
  it("matches every full CBC name exactly", () => {
    for (const m of members) {
      const r = matchPerson(m.name, members);
      expect(r.state).toBe("SUGGESTED");
      expect(r.suggestions[0]).toMatchObject({ userId: m.userId, score: 1, reason: "exact" });
      expect(isExactMatch(r)).toBe(true);
    }
  });

  it("matches the first-name-only diagram labels", () => {
    for (const [label, id] of [
      ["Jackson", "jackson"],
      ["Oliver", "oliver"],
      ["Anthony", "anthony"],
      ["Lucas", "lucas"],
      ["Alex", "alex"],
      ["Smyan", "smyan"],
      ["Kristine", "kristine"],
      ["Mehr", "mehr"],
    ] as const) {
      const r = matchPerson(label, members);
      expect(r.suggestions[0]?.userId).toBe(id);
      expect(r.suggestions[0]?.score).toBeGreaterThanOrEqual(0.85);
      expect(isExactMatch(r)).toBe(false);
    }
  });

  it("handles order, initials, diacritics, typos and email local parts", () => {
    expect(matchPerson("Lamoureux, Jackson", members).suggestions[0]).toMatchObject({
      userId: "jackson",
      reason: "token-set",
    });
    expect(matchPerson("J. Lamoureux", members).suggestions[0]).toMatchObject({ userId: "jackson", reason: "initials" });
    expect(matchPerson("Kristine M.", members).suggestions[0]).toMatchObject({ userId: "kristine", reason: "initials" });
    expect(matchPerson("Smyan Séngupta", members).suggestions[0]).toMatchObject({ userId: "smyan", reason: "exact" });
    expect(matchPerson("Lucas Salzberger", members).suggestions[0]).toMatchObject({ userId: "lucas", reason: "fuzzy" });
    const byEmail = matchPerson("jdoe", [{ userId: "u1", name: "Someone Else", emailLocal: "jdoe" }]);
    expect(byEmail.suggestions[0]).toMatchObject({ userId: "u1", reason: "email" });
  });

  it("suggests but never confirms, and lowers the score for a shared first name", () => {
    const twins: MatchCandidate[] = [
      { userId: "a1", name: "Alex Green" },
      { userId: "a2", name: "Alex Brown" },
    ];
    const r = matchPerson("Alex", twins);
    expect(r.state).toBe("SUGGESTED");
    expect(r.suggestions.map((s) => s.score)).toEqual([0.6, 0.6]);
  });

  it("returns nothing for an unknown or empty name", () => {
    expect(matchPerson("Graphic Designer Candidate", members)).toEqual({
      state: "UNMATCHED",
      score: null,
      suggestions: [],
    });
    expect(matchPerson(null, members).state).toBe("UNMATCHED");
    expect(matchPerson("  ", members).state).toBe("UNMATCHED");
  });

  it("keeps at most three suggestions", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ userId: `s${i}`, name: `Sam Person${i}` }));
    expect(matchPerson("Sam", many).suggestions).toHaveLength(3);
  });
});

describe("helpers", () => {
  it("normalizes names", () => {
    expect(normalizeName("  Zoë  O'Brien-Smith ")).toBe("zoe obrien smith");
  });
  it("computes Jaro-Winkler", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });
});
