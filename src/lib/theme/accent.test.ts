import { describe, expect, it } from "vitest";

import {
  ACCENT_SCALE_NAMES,
  accentScale,
  accentStyleSheet,
  BRAND_ACCENT_SCALE,
  brandPageAccentStyle,
  darkAccentFor,
  withAccent,
} from "./accent";
import { contrastRatio } from "./color";
import { deriveDarkRoles } from "./derive";
import { DEFAULT_PRESET, THEME_PRESETS } from "./presets";
import type { ThemeRoles } from "./types";

const AA = 4.5;
const HEX = /^#[0-9a-f]{6}$/;

/** Every preset in both modes, plus awkward custom accents (dark, grey, neon, near-page, extremes). */
function palettes(): { name: string; roles: ThemeRoles }[] {
  const out = THEME_PRESETS.flatMap((p) => [
    { name: `${p.id}/light`, roles: p.light },
    { name: `${p.id}/dark`, roles: p.dark },
  ]);
  const derivedDark = deriveDarkRoles(DEFAULT_PRESET.light);
  for (const accent of ["#0b1f5c", "#777777", "#39ff14", "#f5f0e4", "#000000", "#ffffff"]) {
    const { light, dark } = withAccent(DEFAULT_PRESET.light, derivedDark, accent);
    out.push({ name: `custom ${accent}/light`, roles: light });
    out.push({ name: `custom ${accent}/dark`, roles: dark });
  }
  return out;
}

describe("accentScale", () => {
  it("keeps Bananasplit's own yellows exactly for the default light palette", () => {
    expect(accentScale(DEFAULT_PRESET.light)).toEqual(BRAND_ACCENT_SCALE);
  });

  it("follows the theme: a green accent gives a green banana, not yellow", () => {
    const evergreen = THEME_PRESETS.find((p) => p.id === "evergreen")!;
    const scale = accentScale(evergreen.light);
    expect(scale.banana).toBe(evergreen.light.accent);
    expect(scale.butter).not.toBe(BRAND_ACCENT_SCALE.butter);
    expect(scale.honey).not.toBe(BRAND_ACCENT_SCALE.honey);
  });

  it("returns every name as a lowercase hex, deterministically", () => {
    for (const { roles } of palettes()) {
      const scale = accentScale(roles);
      expect(Object.keys(scale).sort()).toEqual([...ACCENT_SCALE_NAMES].sort());
      for (const name of ACCENT_SCALE_NAMES) expect(scale[name]).toMatch(HEX);
      expect(accentScale({ ...roles })).toEqual(scale);
    }
  });

  it("keeps every text pairing at WCAG AA, in light and dark, for any accent", () => {
    for (const { name, roles } of palettes()) {
      const s = accentScale(roles);
      // brand.css's fixed values (the default light palette) are the design's
      // own; everything derived is held to AA.
      if (s === BRAND_ACCENT_SCALE) continue;
      const at = (pair: string) => `${name}: ${pair}`;
      for (const fill of ["banana", "lemon", "gold", "ripe"] as const) {
        expect(
          contrastRatio(s["banana-ink"], s[fill]),
          at(`ink on ${fill}`),
        ).toBeGreaterThanOrEqual(AA);
      }
      for (const text of ["honey", "honey-deep", "honey-dark", "honey-hover"] as const) {
        for (const ground of [roles.background, roles.surface, s.butter, s.slice]) {
          expect(contrastRatio(s[text], ground), at(`${text} on ${ground}`)).toBeGreaterThanOrEqual(
            AA,
          );
        }
      }
      for (const text of ["bark", "bark-soft"] as const) {
        expect(contrastRatio(s[text], s.butter), at(`${text} on butter`)).toBeGreaterThanOrEqual(
          AA,
        );
      }
      // The theme's own text still reads on the tints.
      expect(contrastRatio(roles.text, s.butter), at("text on butter")).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(roles.text, s.slice), at("text on slice")).toBeGreaterThanOrEqual(AA);
      // core is a graphic (rings, marks): 3:1 on the page.
      expect(contrastRatio(s.core, roles.background), at("core")).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("withAccent", () => {
  it("is a no-op without an accent and lightens the dark accent with one", () => {
    const dark = deriveDarkRoles(DEFAULT_PRESET.light);
    expect(withAccent(DEFAULT_PRESET.light, dark, null)).toEqual({
      light: DEFAULT_PRESET.light,
      dark,
    });
    const out = withAccent(DEFAULT_PRESET.light, dark, "#1F6B43");
    expect(out.light.accent).toBe("#1f6b43");
    expect(out.dark.accent).toBe(darkAccentFor("#1f6b43"));
    expect(out.light.primary).toBe(DEFAULT_PRESET.light.primary);
  });

  it("ignores anything that is not strict hex", () => {
    const dark = deriveDarkRoles(DEFAULT_PRESET.light);
    expect(withAccent(DEFAULT_PRESET.light, dark, "red").light).toBe(DEFAULT_PRESET.light);
  });
});

describe("accent CSS", () => {
  it("writes both modes, only --color-* names and hex values", () => {
    const css = accentStyleSheet(DEFAULT_PRESET.light, DEFAULT_PRESET.dark);
    expect(css).toMatch(/^html:root\{[^}]+\}html\.dark\{[^}]+\}$/);
    const declarations = css
      .replace(/html(:root|\.dark)\{|\}/g, ";")
      .split(";")
      .filter(Boolean);
    expect(declarations).toHaveLength(ACCENT_SCALE_NAMES.length * 2);
    for (const decl of declarations) expect(decl).toMatch(/^--color-[a-z-]+:#[0-9a-f]{6}$/);
  });

  it("leaves a brand page alone for no accent or the brand's own banana", () => {
    expect(brandPageAccentStyle(null)).toEqual({});
    expect(brandPageAccentStyle("#F2C230")).toEqual({});
    expect(brandPageAccentStyle("javascript:alert(1)")).toEqual({});
  });

  it("re-points a brand page's yellows (and ring) at an organization's accent", () => {
    const style = brandPageAccentStyle("#1d4ed8");
    expect(style["--color-banana"]).toBe("#1d4ed8");
    expect(style["--brand-accent"]).toBe("#1d4ed8");
    expect(contrastRatio(style["--color-banana-ink"]!, "#1d4ed8")).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(style["--ring"]!, "#f7f2e6")).toBeGreaterThanOrEqual(3);
  });
});
