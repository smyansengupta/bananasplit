import { describe, expect, it } from "vitest";

import { SLACK, packSegment, splitEvenly } from "./pack";

const GAP = 18;
const sum = (c: number[], h: readonly number[]) =>
  c.reduce((s, i) => s + h[i]!, 0) + GAP * (c.length - 1);

describe("splitEvenly", () => {
  it("keeps the first widget top left and every column in use", () => {
    const cols = splitEvenly([300, 120, 170, 280, 200], 3, GAP)!;
    expect(cols).toHaveLength(3);
    expect(cols[0]![0]).toBe(0);
    expect(cols.every((c) => c.length > 0)).toBe(true);
  });

  it("finds the most even split", () => {
    const h = [400, 200, 200];
    const cols = splitEvenly(h, 2, GAP)!;
    const hs = cols.map((c) => sum(c, h));
    expect(Math.max(...hs) - Math.min(...hs)).toBe(200 + 200 + GAP - 400);
  });

  it("is null with fewer widgets than columns", () => {
    expect(splitEvenly([100], 2, GAP)).toBeNull();
  });
});

describe("packSegment", () => {
  it("ends every column at the same line", () => {
    const h = [520, 120, 170, 280, 200];
    const seg = packSegment(() => h, h.length, 3, GAP);
    const ends = seg.columns.map((c) => sum(c, h) + c.reduce((s, i) => s + seg.extra[i]!, 0));
    expect(new Set(ends).size).toBe(1);
    expect(ends[0]).toBe(seg.height);
    seg.extra.forEach((e, i) => expect(e).toBeLessThanOrEqual(SLACK * h[i]!));
  });

  it("goes down to one column rather than stretch a widget far past its content", () => {
    // A tall list beside a small card would leave the card mostly empty.
    const seg = packSegment(() => [700, 120], 2, 3, GAP);
    expect(seg.cols).toBe(1);
    expect(seg.extra).toEqual([0, 0]);
    expect(seg.height).toBe(700 + 120 + GAP);
  });

  it("measures at each column count it tries", () => {
    const asked: number[] = [];
    packSegment(
      (k) => {
        asked.push(k);
        return k === 3 ? [600, 100, 100] : [300, 140, 140];
      },
      3,
      3,
      GAP,
    );
    expect(asked[0]).toBe(3);
    expect(asked).toContain(2);
  });

  it("a lone widget is one column", () => {
    expect(packSegment(() => [240], 1, 3, GAP)).toMatchObject({ cols: 1, height: 240 });
  });
});
