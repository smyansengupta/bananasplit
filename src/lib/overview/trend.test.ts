import { describe, expect, it } from "vitest";

import { smoothPath, trendLine } from "./trend";

describe("trendLine", () => {
  it("follows where the weeks are heading, not each week's top", () => {
    const trend = trendLine([0, 0, 0, 0, 1, 2, 2]);
    // Rising throughout, with no corner where the jump happened.
    for (let i = 1; i < trend.length; i++)
      expect(trend[i]).toBeGreaterThanOrEqual(trend[i - 1] - 1e-9);
    expect(trend[3]).toBeGreaterThan(0);
    // Never above the highest week: it follows the bars, not past them.
    expect(Math.max(...trend)).toBeLessThanOrEqual(2);
  });

  it("carries on flat into the week under way", () => {
    const trend = trendLine([0, 1, 2, 2], 1);
    expect(trend[4]).toBe(trend[3]);
  });

  it("bends a little for one odd week instead of spiking to it", () => {
    const trend = trendLine([4, 4, 4, 12, 4, 4, 4]);
    expect(trend[3]).toBeLessThanOrEqual(8);
    expect(trend[3]).toBeGreaterThan(4);
  });

  it("is flat for steady weeks, and carries on past the last one", () => {
    expect(trendLine([3, 3, 3, 3], 1).map((v) => Math.round(v * 100) / 100)).toEqual([
      3, 3, 3, 3, 3,
    ]);
  });

  it("never goes below zero, even heading down", () => {
    expect(Math.min(...trendLine([6, 4, 2, 0, 0], 1))).toBeGreaterThanOrEqual(0);
  });

  it("handles no weeks and one week", () => {
    expect(trendLine([])).toEqual([]);
    expect(trendLine([5], 1)).toEqual([5, 5]);
  });
});

describe("smoothPath", () => {
  it("is one curve through every point, never a corner", () => {
    const d = smoothPath([
      { x: 0, y: 90 },
      { x: 50, y: 50 },
      { x: 100, y: 10 },
    ]);
    expect(d.startsWith("M0,90")).toBe(true);
    expect(d.match(/C/g)).toHaveLength(2);
    expect(d.endsWith("100,10")).toBe(true);
  });

  it("keeps its control points above the baseline", () => {
    const d = smoothPath([
      { x: 0, y: 100 },
      { x: 50, y: 20 },
      { x: 100, y: 100 },
    ]);
    const ys = [...d.matchAll(/[\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
  });
});
