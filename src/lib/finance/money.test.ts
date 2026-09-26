import { describe, expect, it } from "vitest";

import { formatCents, parseDollarsToCents, sumCents } from "./money";

/** Deterministic PRNG so a failing seed is reproducible without a fuzzing library. */
function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("sumCents — property: sum of any list of cent amounts never drifts (spec 5.1)", () => {
  it("matches a naive running total across 500 random lists, exactly, in cents", () => {
    const random = mulberry32(42);
    for (let trial = 0; trial < 500; trial++) {
      const length = Math.floor(random() * 50);
      const amounts = Array.from({ length }, () => Math.floor(random() * 2_000_000) - 1_000_000);

      let expected = 0;
      for (const a of amounts) expected += a;

      expect(sumCents(amounts)).toBe(expected);
      expect(Number.isInteger(sumCents(amounts))).toBe(true);
    }
  });

  it("round-trips through formatCents without losing or gaining a cent", () => {
    const random = mulberry32(7);
    for (let trial = 0; trial < 200; trial++) {
      const length = Math.floor(random() * 20) + 1;
      const amounts = Array.from({ length }, () => Math.floor(random() * 500_000));
      const total = sumCents(amounts);
      const formatted = formatCents(total);
      const reparsed = parseDollarsToCents(formatted.replace("$", ""));
      expect(reparsed).toBe(total);
    }
  });
});

describe("parseDollarsToCents — floats never enter the path (spec 5.1)", () => {
  it("computes 0.1 + 0.2 in cents as exactly 30, never 30.000000000000004", () => {
    const total = sumCents([parseDollarsToCents("0.10"), parseDollarsToCents("0.20")]);
    expect(total).toBe(30);
    expect(formatCents(total)).toBe("$0.30");
  });

  it("parses whole dollars, cents, negatives, and currency-formatted strings", () => {
    expect(parseDollarsToCents("12")).toBe(1200);
    expect(parseDollarsToCents("12.5")).toBe(1250);
    expect(parseDollarsToCents("12.34")).toBe(1234);
    expect(parseDollarsToCents("-5.00")).toBe(-500);
    expect(parseDollarsToCents("$1,234.56")).toBe(123456);
  });

  it("rejects malformed input rather than silently coercing it", () => {
    expect(() => parseDollarsToCents("abc")).toThrow();
    expect(() => parseDollarsToCents("12.345")).toThrow();
    expect(() => parseDollarsToCents("")).toThrow();
  });
});

describe("formatCents", () => {
  it("formats whole and fractional amounts with two decimal places", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(100)).toBe("$1.00");
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(-500)).toBe("-$5.00");
  });
});
