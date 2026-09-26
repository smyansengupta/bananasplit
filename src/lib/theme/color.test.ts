import { describe, expect, it } from "vitest";

import {
  adjustForContrast,
  composite,
  contrastRatio,
  formatRatio,
  hexToOklch,
  hexToRgb,
  isLight,
  mixOklab,
  oklchToHex,
  relativeLuminance,
  rgbToHex,
} from "./color";

describe("colour math", () => {
  it("measures the club website's documented ratios", () => {
    // DESIGN.md: coral fails as text; terracotta is the readable coral.
    expect(contrastRatio("#d97757", "#ffffff")).toBeCloseTo(3.12, 2);
    expect(contrastRatio("#a34a2a", "#faf9f5")).toBeCloseTo(5.58, 2);
    expect(contrastRatio("#d97757", "#faf9f5")).toBeCloseTo(2.96, 2);
  });

  it("gives 21:1 for black on white and 1:1 for a colour on itself, in either order", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#a34a2a", "#a34a2a")).toBe(1);
  });

  it("computes WCAG relative luminance", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 3);
  });

  it("parses only strict #rrggbb", () => {
    expect(hexToRgb("#ff8000")).toEqual({ r: 1, g: 128 / 255, b: 0 });
    for (const bad of ["#fff", "ff8000", "#ff800", "#ff80000", "red", "#gg0000", "#ff8000;"]) {
      expect(() => hexToRgb(bad)).toThrow(TypeError);
    }
  });

  it("round-trips hex through OKLCH", () => {
    for (const hex of [
      "#a34a2a",
      "#d97757",
      "#faf9f5",
      "#141413",
      "#1d4ed8",
      "#000000",
      "#ffffff",
    ]) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it("maps out-of-gamut OKLCH into sRGB by reducing chroma, keeping lightness", () => {
    const hex = oklchToHex({ L: 0.7, C: 0.5, h: 145 });
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(hexToOklch(hex).L).toBeCloseTo(0.7, 2);
  });

  it("mixes in OKLab and composites alpha in sRGB", () => {
    expect(mixOklab("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixOklab("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(composite("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(rgbToHex({ r: 2, g: -1, b: 0.5 })).toBe("#ff0080");
  });

  it("tells light grounds from dark ones", () => {
    expect(isLight("#faf9f5")).toBe(true);
    expect(isLight("#141413")).toBe(false);
  });

  it("adjusts a colour the least distance to reach a contrast target", () => {
    const coral = "#d97757";
    const fixed = adjustForContrast(coral, "#faf9f5", 4.5);
    expect(contrastRatio(fixed, "#faf9f5")).toBeGreaterThanOrEqual(4.5);
    // Same hue family: only the lightness moved.
    expect(Math.abs(hexToOklch(fixed).h - hexToOklch(coral).h)).toBeLessThan(6);
    expect(hexToOklch(fixed).L).toBeLessThan(hexToOklch(coral).L);
    // Already passing: unchanged.
    expect(adjustForContrast("#141413", "#faf9f5", 4.5)).toBe("#141413");
  });

  it("never rounds a failing ratio up to a passing one", () => {
    expect(formatRatio(4.4999)).toBe("4.49:1");
    expect(formatRatio(5.5832)).toBe("5.58:1");
  });
});
