import { contrastRatio, hexToOklch, hexToRgb, oklchToHex } from "./color";

/**
 * The categorical chart palette (--chart-1..5) for any theme, built and
 * checked with the data-viz method (the validated reference palette and its
 * six checks):
 *
 *   2. lightness band per mode   OKLCH L 0.43-0.77 light, 0.48-0.67 dark
 *   3. chroma floor              OKLCH C >= 0.10 (below it a hue reads as grey)
 *   4. CVD separation            adjacent slots, OKLab deltaE x100 >= 8 under
 *                                protanopia and deuteranopia (Machado 2009, 1.0)
 *   4b. normal-vision floor      adjacent slots, deltaE >= 15 unsimulated
 *   5. contrast vs surface       >= 3:1 against the page and the cards
 *
 * Slots come from the reference palette in its fixed order (the order is the
 * CVD-safety mechanism). A reference hex is kept exactly when it passes on the
 * theme's surfaces; otherwise its lightness is snapped (hue held) to the
 * nearest in-band step that clears 3:1 ("snap to passing"). A theme with a
 * chromatic primary gets the brand as slot 1, and reference slots whose hue
 * would impersonate the brand are skipped. Every slot is only accepted next to
 * its neighbour if the adjacent CVD and normal-vision gates pass.
 */

export type ChartMode = "light" | "dark";

/** The validated reference palette (8 hues, fixed order), per mode. */
export const REFERENCE_CHART_PALETTE: Record<ChartMode, readonly string[]> = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

export const CHART_BAND: Record<ChartMode, readonly [number, number]> = {
  light: [0.43, 0.77],
  dark: [0.48, 0.67],
};
export const CHART_CHROMA_FLOOR = 0.1;
export const CHART_CVD_TARGET = 8;
export const CHART_NORMAL_FLOOR = 15;
export const CHART_CONTRAST_MIN = 3;
export const CHART_SLOTS = 5;

/** Hue distance (degrees) under which a reference slot would read as the brand. */
const BRAND_HUE_GAP = 35;

// Machado, Oliveira & Fernandes (2009) at severity 1.0, on linear RGB.
const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

type Vec3 = [number, number, number];

function linear(hex: string): Vec3 {
  const { r, g, b } = hexToRgb(hex);
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [f(r), f(g), f(b)];
}

function oklabFromLinear([r, g, b]: Vec3): Vec3 {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function simulate(hex: string, kind: keyof typeof MACHADO): Vec3 {
  const [r, g, b] = linear(hex);
  const M = MACHADO[kind];
  const clamp = (c: number) => Math.max(0, Math.min(1, c));
  return [
    clamp(M[0][0] * r + M[0][1] * g + M[0][2] * b),
    clamp(M[1][0] * r + M[1][1] * g + M[1][2] * b),
    clamp(M[2][0] * r + M[2][1] * g + M[2][2] * b),
  ];
}

/** OKLab deltaE x100, unsimulated or under a colour-vision deficiency. */
export function chartDeltaE(a: string, b: string, kind?: keyof typeof MACHADO): number {
  const x = oklabFromLinear(kind ? simulate(a, kind) : linear(a));
  const y = oklabFromLinear(kind ? simulate(b, kind) : linear(b));
  return 100 * Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** The worse of the protan and deutan deltaE. */
export function cvdDeltaE(a: string, b: string): number {
  return Math.min(chartDeltaE(a, b, "protan"), chartDeltaE(a, b, "deutan"));
}

function inBand(hex: string, mode: ChartMode): boolean {
  const { L } = hexToOklch(hex);
  const [lo, hi] = CHART_BAND[mode];
  return L >= lo - 1e-6 && L <= hi + 1e-6;
}

function readsOn(hex: string, surfaces: readonly string[]): boolean {
  return surfaces.every((surface) => contrastRatio(hex, surface) >= CHART_CONTRAST_MIN);
}

function slotPasses(hex: string, mode: ChartMode, surfaces: readonly string[]): boolean {
  return (
    inBand(hex, mode) && hexToOklch(hex).C >= CHART_CHROMA_FLOOR - 1e-6 && readsOn(hex, surfaces)
  );
}

/**
 * The colour itself when it passes the band, chroma and contrast checks on
 * these surfaces; otherwise the nearest lightness (hue and chroma held where
 * the gamut allows) inside the band that does; null when none does.
 */
export function snapChartColor(
  hex: string,
  mode: ChartMode,
  surfaces: readonly string[],
): string | null {
  if (slotPasses(hex, mode, surfaces)) return hex;
  const base = hexToOklch(hex);
  const [lo, hi] = CHART_BAND[mode];
  const start = Math.min(hi, Math.max(lo, base.L));
  const steps: number[] = [];
  for (let L = lo; L <= hi + 1e-9; L += 0.005) steps.push(L);
  steps.sort((a, b) => Math.abs(a - start) - Math.abs(b - start));
  for (const L of steps) {
    const candidate = oklchToHex({ L, C: Math.max(base.C, CHART_CHROMA_FLOOR), h: base.h });
    if (slotPasses(candidate, mode, surfaces)) return candidate;
  }
  return null;
}

function adjacentOk(a: string, b: string): boolean {
  return cvdDeltaE(a, b) >= CHART_CVD_TARGET && chartDeltaE(a, b) >= CHART_NORMAL_FLOOR;
}

function hueGap(a: string, b: string): number {
  const d = Math.abs(hexToOklch(a).h - hexToOklch(b).h);
  return Math.min(d, 360 - d);
}

/**
 * Five validated categorical slots for a theme. `surfaces` are what the marks
 * sit on (the page background and the cards); `mode` is the lightness band,
 * from whether those surfaces are light or dark.
 */
export function deriveChartPalette(
  primary: string,
  mode: ChartMode,
  surfaces: readonly string[],
): string[] {
  const reference = REFERENCE_CHART_PALETTE[mode];
  const snapped = reference.map((hex) => snapChartColor(hex, mode, surfaces));

  const brand =
    hexToOklch(primary).C >= CHART_CHROMA_FLOOR ? snapChartColor(primary, mode, surfaces) : null;

  const pick = (seed: string[], pool: (string | null)[]): string[] => {
    const out = [...seed];
    const rest = pool.filter(
      (hex): hex is string =>
        hex !== null && !out.includes(hex) && seed.every((s) => hueGap(s, hex) >= BRAND_HUE_GAP),
    );
    // Fixed reference order; a slot that would sit too close to its
    // neighbour waits for a later position.
    while (out.length < CHART_SLOTS && rest.length > 0) {
      const index = rest.findIndex(
        (hex) => out.length === 0 || adjacentOk(out[out.length - 1], hex),
      );
      if (index === -1) break;
      out.push(rest.splice(index, 1)[0]);
    }
    return out;
  };

  if (brand) {
    const withBrand = pick([brand], snapped);
    if (withBrand.length === CHART_SLOTS) return withBrand;
  }
  const plain = pick([], snapped);
  if (plain.length === CHART_SLOTS) return plain;
  // Nothing in band clears the surfaces (an unusual mid-grey page): fall back
  // to the reference hexes. The contrast check then warns, and charts must
  // carry labels or a table view (the relief rule).
  return reference.slice(0, CHART_SLOTS);
}

export interface ChartPaletteReport {
  band: boolean;
  chroma: boolean;
  /** Worst adjacent protan/deutan deltaE (>= 8 target). */
  worstCvd: number;
  /** Worst adjacent unsimulated deltaE (>= 15 floor). */
  worstNormal: number;
  /** Slots under 3:1 on any surface. */
  lowContrast: string[];
  ok: boolean;
}

/** The computable data-viz checks for a palette (adjacent pairlist). */
export function checkChartPalette(
  palette: readonly string[],
  mode: ChartMode,
  surfaces: readonly string[],
): ChartPaletteReport {
  const band = palette.every((hex) => inBand(hex, mode));
  const chroma = palette.every((hex) => hexToOklch(hex).C >= CHART_CHROMA_FLOOR - 1e-6);
  let worstCvd = Number.POSITIVE_INFINITY;
  let worstNormal = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < palette.length; i++) {
    worstCvd = Math.min(worstCvd, cvdDeltaE(palette[i], palette[i + 1]));
    worstNormal = Math.min(worstNormal, chartDeltaE(palette[i], palette[i + 1]));
  }
  const lowContrast = palette.filter((hex) => !readsOn(hex, surfaces));
  return {
    band,
    chroma,
    worstCvd,
    worstNormal,
    lowContrast,
    ok:
      band &&
      chroma &&
      worstCvd >= CHART_CVD_TARGET &&
      worstNormal >= CHART_NORMAL_FLOOR &&
      lowContrast.length === 0,
  };
}
