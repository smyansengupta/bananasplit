import { describe, expect, it } from "vitest";

import { contrastRatio } from "./color";
import { checkTokens, CONTRAST_PAIRS, contrastWarnings, suggestFix } from "./contrast";
import { deriveTokens } from "./derive";
import { THEME_PRESETS } from "./presets";
import type { ThemeRoles } from "./types";

const FAILING: ThemeRoles = {
  primary: "#ffcc00", // yellow: fails as link text on white
  accent: "#ffee00",
  background: "#ffffff",
  surface: "#f0f0f0",
  text: "#999999", // grey: fails as body text
};

describe("contrast check", () => {
  it.each(THEME_PRESETS.map((p) => [p.name, p] as const))(
    "the %s preset passes WCAG AA in light and dark",
    (_name, preset) => {
      expect(contrastWarnings(preset.light, preset.dark)).toEqual([]);
      for (const mode of ["light", "dark"] as const) {
        const results = checkTokens(deriveTokens(preset[mode]), mode);
        expect(results).toHaveLength(CONTRAST_PAIRS.length);
        expect(results.filter((r) => !r.pass)).toEqual([]);
      }
    },
  );

  it("checks the important pairs at 4.5:1 and the non-text ones at 3:1", () => {
    const byId = new Map(CONTRAST_PAIRS.map((p) => [p.id, p]));
    for (const id of [
      "text-background",
      "text-card",
      "text-popover",
      "primary-label",
      "primary-hover-label",
      "primary-link",
      "muted-background",
      "muted-muted",
      "sidebar-text",
    ]) {
      expect(byId.get(id)?.required).toBe(4.5);
    }
    expect(byId.get("focus-ring")?.required).toBe(3);
    expect(byId.get("chart-1")?.required).toBe(3);
  });

  it("warns about a failing custom theme with ratios, thresholds and a fix", () => {
    const warnings = contrastWarnings(FAILING, null);
    const light = warnings.filter((w) => w.mode === "light");
    const ids = light.map((w) => w.pair);
    expect(ids).toContain("text-background");
    expect(ids).toContain("primary-link");

    const text = light.find((w) => w.pair === "text-background")!;
    expect(text.ratio).toBeCloseTo(contrastRatio("#999999", "#ffffff"), 6);
    expect(text.ratio).toBeLessThan(4.5);
    expect(text.required).toBe(4.5);
    expect(text.fg).toBe("#999999");
    expect(text.bg).toBe("#ffffff");
    expect(text.fix).toMatchObject({ mode: "light", role: "text" });
    expect(text.fix!.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it("suggests fixes that really pass once applied", () => {
    for (const warning of contrastWarnings(FAILING, null)) {
      if (!warning.fix || warning.mode !== "light") continue;
      const fixed = { ...FAILING, [warning.fix.role]: warning.fix.value };
      const pair = CONTRAST_PAIRS.find((p) => p.id === warning.pair)!;
      const tokens = deriveTokens(fixed);
      expect(contrastRatio(tokens[pair.fg], tokens[pair.bg])).toBeGreaterThanOrEqual(pair.required);
    }
  });

  it("offers one fix per role that clears every pair that role controls", () => {
    const light = contrastWarnings(FAILING, null).filter((w) => w.mode === "light");
    const textFixes = new Set(light.filter((w) => w.fix?.role === "text").map((w) => w.fix!.value));
    expect(textFixes.size).toBe(1);
    const fixed = { ...FAILING, text: [...textFixes][0] };
    const after = contrastWarnings(fixed, null).filter((w) => w.mode === "light");
    expect(
      after.filter((w) => CONTRAST_PAIRS.find((p) => p.id === w.pair)?.role === "text"),
    ).toEqual([]);
  });

  it("returns no fix for a pair no single role controls", () => {
    const pair = CONTRAST_PAIRS.find((p) => p.id === "destructive-text")!;
    expect(suggestFix(FAILING, "light", pair)).toBeNull();
  });

  it("checks the derived dark palette when Dark is left empty", () => {
    // A bright light background still yields a readable derived dark theme.
    const warnings = contrastWarnings(THEME_PRESETS[1].light, null);
    expect(warnings.filter((w) => w.mode === "dark")).toEqual([]);
  });
});
