import { describe, expect, it } from "vitest";

import { contrastRatio, hexToOklch, isLight } from "./color";
import { checkChartPalette } from "./chart";
import { deriveDarkRoles, deriveTheme, deriveTokens, TOKEN_NAMES } from "./derive";
import { CBC_PRESET, THEME_PRESETS } from "./presets";
import { HEX_RE } from "./validate";

describe("deriveTokens", () => {
  it("is deterministic", () => {
    for (const preset of THEME_PRESETS) {
      expect(deriveTokens(preset.light)).toEqual(deriveTokens(preset.light));
      expect(deriveTheme(preset.light, null)).toEqual(deriveTheme(preset.light, null));
    }
    const custom = {
      primary: "#3355aa",
      accent: "#ee8844",
      background: "#fdfcfa",
      surface: "#ffffff",
      text: "#222222",
    };
    expect(JSON.stringify(deriveTokens(custom))).toBe(JSON.stringify(deriveTokens({ ...custom })));
  });

  it("returns every token, each a lowercase #rrggbb", () => {
    const tokens = deriveTokens(CBC_PRESET.light);
    expect(Object.keys(tokens).sort()).toEqual([...TOKEN_NAMES].sort());
    for (const name of TOKEN_NAMES) expect(tokens[name]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("maps the five roles onto the shadcn tokens", () => {
    const { light } = CBC_PRESET;
    const tokens = deriveTokens(light);
    expect(tokens.background).toBe(light.background);
    expect(tokens.foreground).toBe(light.text);
    expect(tokens.card).toBe(light.surface);
    expect(tokens.popover).toBe(light.surface);
    expect(tokens.primary).toBe(light.primary);
    expect(tokens["brand-accent"]).toBe(light.accent);
    expect(tokens["sidebar-primary"]).toBe(light.primary);
    // A chromatic, in-band brand primary leads the chart palette.
    expect(tokens["chart-1"]).toBe(light.primary);
  });

  it("derives foregrounds and status colours that clear AA on the page and on cards", () => {
    for (const preset of THEME_PRESETS) {
      for (const roles of [preset.light, preset.dark]) {
        const t = deriveTokens(roles);
        expect(contrastRatio(t["primary-foreground"], t.primary)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t["primary-foreground"], t["primary-hover"])).toBeGreaterThanOrEqual(
          4.5,
        );
        expect(contrastRatio(t["muted-foreground"], t.muted)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(t["muted-foreground"], t.card)).toBeGreaterThanOrEqual(4.5);
        for (const status of ["destructive", "success", "warning"] as const) {
          expect(contrastRatio(t[status], t.background)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(t[status], t.card)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(t[`${status}-foreground`], t[status])).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("builds a validated categorical chart palette for every preset", () => {
    for (const preset of THEME_PRESETS) {
      for (const roles of [preset.light, preset.dark]) {
        const t = deriveTokens(roles);
        const charts = [t["chart-1"], t["chart-2"], t["chart-3"], t["chart-4"], t["chart-5"]];
        const mode = isLight(t.background) ? "light" : "dark";
        const report = checkChartPalette(charts, mode, [t.background, t.card]);
        expect(report, `${preset.id} ${mode}`).toMatchObject({
          ok: true,
          band: true,
          chroma: true,
        });
        expect(new Set(charts).size).toBe(5);
      }
    }
  });

  it("keeps the hover colour readable where Tailwind's bg-primary/80 would not", () => {
    // Terracotta at 80% over paper drops a white label to ~3.8:1.
    const t = deriveTokens(CBC_PRESET.light);
    expect(t["primary-hover"]).not.toBe(t.primary);
    expect(contrastRatio(t["primary-foreground"], t["primary-hover"])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("deriveDarkRoles", () => {
  it("turns a light palette into a dark one that keeps the brand hue", () => {
    const dark = deriveDarkRoles(CBC_PRESET.light);
    for (const value of Object.values(dark)) expect(value).toMatch(HEX_RE);
    expect(isLight(dark.background)).toBe(false);
    expect(isLight(dark.text)).toBe(true);
    expect(contrastRatio(dark.text, dark.background)).toBeGreaterThanOrEqual(12);
    expect(contrastRatio(dark.primary, dark.background)).toBeGreaterThanOrEqual(4.5);
    const hueShift = Math.abs(hexToOklch(dark.primary).h - hexToOklch(CBC_PRESET.light.primary).h);
    expect(Math.min(hueShift, 360 - hueShift)).toBeLessThan(8);
  });

  it("is what deriveTheme uses when the dark palette is left empty", () => {
    const theme = deriveTheme(CBC_PRESET.light, null);
    expect(theme.dark).toEqual(deriveTokens(deriveDarkRoles(CBC_PRESET.light)));
    expect(deriveTheme(CBC_PRESET.light, CBC_PRESET.dark).dark).toEqual(
      deriveTokens(CBC_PRESET.dark),
    );
  });
});
