import { describe, expect, it } from "vitest";

import {
  excerptAround,
  fold,
  highlightRanges,
  openingLine,
  parseQuery,
  prefixTsQuery,
  scoreFields,
} from "./text";

describe("parseQuery", () => {
  it("splits into lowercase words, dropping punctuation and repeats", () => {
    const q = parseQuery("  Budget-Review   budget, Q3!! ");
    expect(q.text).toBe("Budget-Review budget, Q3!!");
    expect(q.terms).toEqual(["budget", "review", "q3"]);
    expect(q.phrase).toBe("budget review q3");
  });

  it("keeps accents for the database and folds them for scoring", () => {
    const q = parseQuery("Café Élan");
    expect(q.terms).toEqual(["café", "élan"]);
    expect(q.folded).toEqual(["cafe", "elan"]);
  });

  it("reads decomposed accents as part of the word", () => {
    // "résumé" typed or pasted as e + U+0301.
    const q = parseQuery("Re\u0301sume\u0301 tips");
    expect(q.terms).toEqual(["résumé", "tips"]);
    expect(q.folded).toEqual(["resume", "tips"]);
    // A combining mark that has no precomposed form stays inside its word.
    expect(parseQuery("नमस्ते").terms).toEqual(["नमस्ते"]);
  });

  it("never emits LIKE wildcards or tsquery operators", () => {
    const q = parseQuery("100% _done_ & !(x | y):* <-> 'z'");
    for (const term of q.terms) expect(term).toMatch(/^[\p{L}\p{N}][\p{L}\p{M}\p{N}]*$/u);
    expect(prefixTsQuery(q.terms)).toBe("100:* & done:* & x:* & y:* & z:*");
    expect(prefixTsQuery(["a", "b"], { any: true })).toBe("a:* | b:*");
  });

  it("caps the number and length of words", () => {
    const q = parseQuery(Array.from({ length: 20 }, (_, i) => `w${i}`).join(" "));
    expect(q.terms).toHaveLength(8);
    expect(parseQuery("a".repeat(100)).terms[0]).toHaveLength(40);
    expect(parseQuery("!!! ...").terms).toEqual([]);
    expect(prefixTsQuery([])).toBeNull();
  });
});

describe("fold", () => {
  it("keeps every index lined up with the original", () => {
    for (const text of ["Ünïcödé café", "İstanbul", "naïve 🎉 résumé", "ß"]) {
      expect(fold(text)).toHaveLength(text.length);
    }
    expect(fold("Crème Brûlée")).toBe("creme brulee");
  });
});

describe("scoreFields", () => {
  const score = (query: string, ...fields: [string | null, number][]) =>
    scoreFields(
      fields.map(([text, weight]) => ({ text, weight })),
      parseQuery(query),
    );

  it("prefers the name being the query, then starting with it, then containing it", () => {
    const exact = score("budget", ["Budget", 3]);
    const starts = score("budget", ["Budget review", 3]);
    const inside = score("budget", ["Spring budget", 3]);
    const partial = score("budget", ["Budgeting 101", 3]);
    expect(exact).toBeGreaterThan(starts);
    expect(starts).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(partial);
    // While a word is still being typed, the name that starts with it leads.
    expect(score("budg", ["Budget review", 3])).toBeGreaterThan(
      score("budg", ["Spring budget", 3]),
    );
  });

  it("counts a match in the name above one in the body", () => {
    expect(score("gala", ["Gala venue", 3], ["", 1])).toBeGreaterThan(
      score("gala", ["Venue", 3], ["for the gala", 1]),
    );
  });

  it("matches words in any order, and rewards the whole phrase in the name", () => {
    expect(score("review budget", ["Budget review", 3])).toBeGreaterThan(0);
    expect(score("budget review", ["Budget review", 3])).toBeGreaterThan(
      score("review budget", ["Budget review", 3]),
    );
  });

  it("ignores case and accents", () => {
    expect(score("cafe", ["Café night", 3])).toBe(score("café", ["Cafe night", 3]));
  });

  it("scores missing words down, or out with requireAll", () => {
    const q = parseQuery("budget zebra");
    const fields = [{ text: "Budget review", weight: 3 }];
    expect(scoreFields(fields, q)).toBeGreaterThan(0);
    expect(scoreFields(fields, q)).toBeLessThan(scoreFields(fields, parseQuery("budget")));
    expect(scoreFields(fields, q, { requireAll: true })).toBe(0);
    expect(scoreFields(fields, parseQuery(""))).toBe(0);
  });
});

describe("highlightRanges", () => {
  it("marks every occurrence, merging overlaps", () => {
    expect(highlightRanges("Budget review: budgets", ["budget", "bud"])).toEqual([
      [0, 6],
      [15, 21],
    ]);
  });

  it("lines up with the original text through accents", () => {
    const text = "Réunion du café";
    const [range] = highlightRanges(text, ["cafe"]);
    expect(text.slice(range[0], range[1])).toBe("café");
  });

  it("only marks one- and two-letter words at the start of a word", () => {
    expect(highlightRanges("Data and AI", ["a"])).toEqual([
      [5, 6],
      [9, 10],
    ]);
    expect(highlightRanges("Said AI", ["ai"])).toEqual([[5, 7]]);
  });
});

describe("excerptAround", () => {
  const long = `${"Lorem ipsum dolor sit amet. ".repeat(10)}The treasurer approved the gala deposit today. ${"More filler text here. ".repeat(10)}`;

  it("cuts around the first match at word boundaries", () => {
    const excerpt = excerptAround(long, ["gala"], 80)!;
    expect(excerpt).toContain("gala deposit");
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(82);
    expect(excerpt).not.toMatch(/^…\S*\s{2}/);
  });

  it("returns short text whole, and null without a match", () => {
    expect(excerptAround("A  short\nnote about gala", ["gala"])).toBe("A short note about gala");
    expect(excerptAround(long, ["zebra"])).toBeNull();
    expect(excerptAround(null, ["gala"])).toBeNull();
  });
});

describe("openingLine", () => {
  it("is the first line's worth, cut at a word", () => {
    expect(openingLine("Hello   world")).toBe("Hello world");
    expect(openingLine(`${"word ".repeat(40)}`, 30)).toBe("word word word word word word…");
    expect(openingLine("   ")).toBeNull();
  });
});
