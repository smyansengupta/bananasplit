import {
  adjustForContrast,
  bestContrast,
  contrastRatio,
  hexToOklch,
  isLight,
  mixOklab,
  oklchToHex,
} from "./color";
import type { ThemeRoles } from "./types";

/**
 * Maps the five colour roles to the full design-token set (the shadcn
 * tokens in globals.css plus --primary-hover, --brand-accent, --success,
 * --warning and a categorical chart palette).
 *
 * Deterministic and pure: the same roles always give the same tokens, on
 * the server and in the browser. Derived foregrounds and status colours are
 * nudged (OKLCH lightness only, hue kept) until they clear WCAG AA against
 * the surfaces they sit on, so a warning can only come from the roles the
 * org picked itself (text on background, primary on background, ...).
 *
 * Every value is a lowercase `#rrggbb`, which is what the render-time check
 * in css.ts accepts.
 */

export const TOKEN_NAMES = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "primary-hover",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "brand-accent",
  "brand-accent-foreground",
  "destructive",
  "destructive-foreground",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type TokenMap = Record<TokenName, string>;

export interface DerivedTheme {
  light: TokenMap;
  dark: TokenMap;
}

/** Text/icons on a fill: AA for normal text, with a hair of margin for rounding. */
const TEXT_TARGET = 4.6;
/** Non-text (focus ring, chart marks): WCAG 1.4.11. */
const GRAPHIC_TARGET = 3.05;

const WHITE = "#ffffff";
const BLACK = "#000000";

/**
 * The foreground for text on `fill`: the palette's own text or background
 * colour when one of them reads, else plain white or black.
 */
function onFill(fill: string, palette: readonly string[]): string {
  const preferred = bestContrast(fill, palette);
  if (contrastRatio(preferred, fill) >= TEXT_TARGET) return preferred;
  const pure = bestContrast(fill, [WHITE, BLACK]);
  return contrastRatio(pure, fill) > contrastRatio(preferred, fill) ? pure : preferred;
}

/** Adjusts `color` until it clears `target` against every one of `grounds`. */
function readableOn(color: string, grounds: readonly string[], target: number): string {
  let result = color;
  // Two passes: fixing against one ground can undo another only marginally.
  for (let pass = 0; pass < 2; pass++) {
    for (const ground of grounds) result = adjustForContrast(result, ground, target);
  }
  return result;
}

/** A tint of `ground` towards `tint` that keeps `text` readable on it. */
function readableTint(ground: string, tint: string, amount: number, text: string): string {
  for (let t = amount; t > 0.001; t -= 0.02) {
    const candidate = mixOklab(ground, tint, t);
    if (contrastRatio(text, candidate) >= TEXT_TARGET) return candidate;
  }
  return ground;
}

/** A status colour (fixed hue) readable as text on the page and on cards. */
function statusColor(
  hue: number,
  chroma: number,
  dark: boolean,
  lightL: number,
  darkL: number,
  grounds: readonly string[],
): string {
  return readableOn(
    oklchToHex({ L: dark ? darkL : lightL, C: chroma, h: hue }),
    grounds,
    TEXT_TARGET,
  );
}

/** Hue offsets from the primary for the categorical chart palette. */
const CHART_HUE_OFFSETS = [0, 210, 90, 300, 150];
/** Used when the primary is (near) grey and has no usable hue. */
const NEUTRAL_CHART_HUES = [255, 40, 145, 305, 85];

function chartPalette(primary: string, dark: boolean, grounds: readonly string[]): string[] {
  const p = hexToOklch(primary);
  const chromatic = p.C >= 0.04;
  const chroma = chromatic ? Math.min(0.16, Math.max(0.1, p.C)) : 0.13;
  const L = dark ? 0.74 : 0.6;
  return CHART_HUE_OFFSETS.map((offset, i) => {
    const seed =
      chromatic && i === 0
        ? primary
        : oklchToHex({ L, C: chroma, h: chromatic ? p.h + offset : NEUTRAL_CHART_HUES[i] });
    return readableOn(seed, grounds, GRAPHIC_TARGET);
  });
}

/**
 * The primary's hover colour. It replaces Tailwind's `bg-primary/80` (which
 * lightens a dark primary towards the page and can drop its label below AA)
 * with a shift the label always survives: towards the page when that stays
 * readable, otherwise away from the label.
 */
function primaryHover(primary: string, foreground: string, background: string): string {
  const p = hexToOklch(primary);
  const towardPage = isLight(background) ? 1 : -1;
  const soft = oklchToHex({ ...p, L: p.L + towardPage * 0.06 });
  if (contrastRatio(foreground, soft) >= TEXT_TARGET) return soft;
  const awayFromLabel = isLight(foreground) ? -1 : 1;
  const firm = oklchToHex({ ...p, L: p.L + awayFromLabel * 0.06 });
  return contrastRatio(foreground, firm) >= contrastRatio(foreground, primary) ? firm : primary;
}

/** The full token map for one palette. */
export function deriveTokens(roles: ThemeRoles): TokenMap {
  const { primary, accent, background, surface, text } = roles;
  const dark = !isLight(background);
  const palette = [text, background, surface];

  const primaryForeground = onFill(primary, palette);

  const muted = mixOklab(background, text, dark ? 0.11 : 0.045);
  const secondary = muted;
  // Secondary text: start two-fifths of the way from the text to the page,
  // then pull towards the text until it reads on every ground it sits on.
  const mutedForeground = readableOn(
    mixOklab(text, background, 0.42),
    [muted, background, surface],
    TEXT_TARGET,
  );

  const accentTint = readableTint(background, accent, dark ? 0.2 : 0.14, text);

  const destructive = statusColor(27, dark ? 0.19 : 0.23, dark, 0.56, 0.7, [background, surface]);
  const success = statusColor(152, dark ? 0.15 : 0.14, dark, 0.52, 0.76, [background, surface]);
  const warning = statusColor(70, dark ? 0.15 : 0.14, dark, 0.52, 0.8, [background, surface]);

  const border = mixOklab(background, text, dark ? 0.16 : 0.11);
  const input = mixOklab(background, text, dark ? 0.2 : 0.13);
  const ring = readableOn(primary, [background, surface], GRAPHIC_TARGET);

  const sidebar = dark ? surface : mixOklab(background, text, 0.025);
  const sidebarAccent = readableTint(sidebar, accent, dark ? 0.22 : 0.16, text);

  const [chart1, chart2, chart3, chart4, chart5] = chartPalette(primary, dark, [
    background,
    surface,
  ]);

  return {
    background,
    foreground: text,
    card: surface,
    "card-foreground": text,
    popover: surface,
    "popover-foreground": text,
    primary,
    "primary-foreground": primaryForeground,
    "primary-hover": primaryHover(primary, primaryForeground, background),
    secondary,
    "secondary-foreground": text,
    muted,
    "muted-foreground": mutedForeground,
    accent: accentTint,
    "accent-foreground": text,
    "brand-accent": accent,
    "brand-accent-foreground": onFill(accent, palette),
    destructive,
    "destructive-foreground": onFill(destructive, [WHITE, BLACK]),
    success,
    "success-foreground": onFill(success, [WHITE, BLACK]),
    warning,
    "warning-foreground": onFill(warning, [WHITE, BLACK]),
    border,
    input,
    ring,
    "chart-1": chart1,
    "chart-2": chart2,
    "chart-3": chart3,
    "chart-4": chart4,
    "chart-5": chart5,
    sidebar,
    "sidebar-foreground": text,
    "sidebar-primary": primary,
    "sidebar-primary-foreground": primaryForeground,
    "sidebar-accent": sidebarAccent,
    "sidebar-accent-foreground": text,
    "sidebar-border": mixOklab(sidebar, text, dark ? 0.16 : 0.11),
    "sidebar-ring": ring,
  };
}

/**
 * A dark palette from a light one, for orgs that leave Dark empty: the page
 * and surfaces go near-black with the light background's tint, text goes
 * near-white, and primary/accent keep their hue and chroma but lighten until
 * they read on the dark page.
 */
export function deriveDarkRoles(light: ThemeRoles): ThemeRoles {
  const bg = hexToOklch(light.background);
  const tintChroma = Math.min(bg.C, 0.012);
  const background = oklchToHex({ L: 0.17, C: tintChroma, h: bg.h });
  const surface = oklchToHex({ L: 0.215, C: tintChroma, h: bg.h });
  const text = oklchToHex({ L: 0.965, C: Math.min(tintChroma, 0.008), h: bg.h });

  const p = hexToOklch(light.primary);
  const primary = readableOn(
    oklchToHex({ L: Math.max(p.L, 0.7), C: Math.min(p.C, 0.2), h: p.h }),
    [background, surface],
    TEXT_TARGET,
  );
  const a = hexToOklch(light.accent);
  const accent = oklchToHex({ L: Math.max(a.L, 0.74), C: Math.min(a.C, 0.18), h: a.h });

  return { primary, accent, background, surface, text };
}

/** Both modes' tokens. `dark` null means "derive it from light". */
export function deriveTheme(light: ThemeRoles, dark: ThemeRoles | null): DerivedTheme {
  return {
    light: deriveTokens(light),
    dark: deriveTokens(dark ?? deriveDarkRoles(light)),
  };
}
