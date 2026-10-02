import { describe, expect, it } from "vitest";

import {
  checkChartPalette,
  deriveChartPalette,
  REFERENCE_CHART_PALETTE,
  snapChartColor,
} from "./chart";
import { contrastRatio, hexToOklch, oklchToHex } from "./color";
import { deriveTokens } from "./derive";
import { DEFAULT_PRESET, GRAPHITE_PRESET } from "./presets";

describe("chart palette", () => {
  it("validates the reference palette's first five slots on its own surfaces", () => {
    expect(
      checkChartPalette(REFERENCE_CHART_PALETTE.dark.slice(0, 5), "dark", ["#1a1a19"]).ok,
    ).toBe(true);
    // Light slots 3-5 sit under 3:1 on white by design (the relief rule).
    const light = checkChartPalette(REFERENCE_CHART_PALETTE.light.slice(0, 5), "light", [
      "#fcfcfb",
    ]);
    expect(light.worstCvd).toBeGreaterThanOrEqual(8);
    expect(light.worstNormal).toBeGreaterThanOrEqual(15);
    expect(light.lowContrast.length).toBeGreaterThan(0);
  });

  it("gives an achromatic theme (Graphite) the validated default slots", () => {
    const light = deriveTokens(GRAPHITE_PRESET.light);
    expect([light["chart-1"], light["chart-2"]]).toEqual(["#2a78d6", "#eb6834"]);
    const dark = deriveTokens(GRAPHITE_PRESET.dark);
    expect([
      dark["chart-1"],
      dark["chart-2"],
      dark["chart-3"],
      dark["chart-4"],
      dark["chart-5"],
    ]).toEqual(REFERENCE_CHART_PALETTE.dark.slice(0, 5));
  });

  it("leads the Default (Bananasplit) charts with its raspberry, passing every gate", () => {
    const { primary, background, surface } = DEFAULT_PRESET.light;
    const palette = deriveChartPalette(primary, "light", [background, surface]);
    expect(palette[0]).toBe(primary);
    expect(checkChartPalette(palette, "light", [background, surface]).ok).toBe(true);
  });

  it("snaps a slot's lightness (hue held) until it reads on the surface", () => {
    const aqua = REFERENCE_CHART_PALETTE.light[2];
    expect(contrastRatio(aqua, "#ffffff")).toBeLessThan(3);
    const snapped = snapChartColor(aqua, "light", ["#ffffff"])!;
    expect(contrastRatio(snapped, "#ffffff")).toBeGreaterThanOrEqual(3);
    const shift = Math.abs(hexToOklch(snapped).h - hexToOklch(aqua).h);
    expect(Math.min(shift, 360 - shift)).toBeLessThan(6);
    expect(snapChartColor("#2a78d6", "light", ["#ffffff"])).toBe("#2a78d6");
  });

  it("passes every gate for random light and dark themes", () => {
    // Deterministic pseudo-random walk over hues, chromas and page tints.
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 150; i++) {
      const primary = oklchToHex({ L: 0.35 + rand() * 0.4, C: rand() * 0.25, h: rand() * 360 });
      const light = oklchToHex({ L: 0.96 + rand() * 0.04, C: rand() * 0.02, h: rand() * 360 });
      const dark = oklchToHex({ L: 0.12 + rand() * 0.1, C: rand() * 0.03, h: rand() * 360 });
      for (const [mode, surfaces] of [
        ["light", [light, "#ffffff"]],
        ["dark", [dark, oklchToHex({ ...hexToOklch(dark), L: hexToOklch(dark).L + 0.04 })]],
      ] as const) {
        const palette = deriveChartPalette(primary, mode, surfaces);
        const report = checkChartPalette(palette, mode, surfaces);
        expect(report, `${primary} on ${surfaces.join("/")}`).toMatchObject({ ok: true });
        expect(palette).toHaveLength(5);
      }
    }
  });

  it("leads with a chromatic brand and skips reference hues that would impersonate it", () => {
    const palette = deriveChartPalette("#a34a2a", "light", ["#faf9f5", "#ffffff"]);
    expect(palette[0]).toBe("#a34a2a");
    expect(palette).not.toContain("#eb6834"); // orange sits next to terracotta
  });
});
