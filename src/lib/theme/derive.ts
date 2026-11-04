import {
  adjustForContrast,
  bestContrast,
  contrastRatio,
  hexToOklch,
  isLight,
  mixOklab,
  oklchToHex,
} from "./color";
import { deriveChartPalette } from "./chart";
import type { ThemeRoles } from "./types";

/**
 * Maps the five colour roles to the full design-token set (the shadcn
 * tokens in globals.css plus --primary-hover, --brand-accent, --success,
 * --warning and a validated categorical chart palette, see chart.ts).
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
  // The create button (New task, New event): the accent, except where the
  // accent is the ink itself (Moonstone in light), where it is the white
  // surface, lit by the glow, as Moonstone's pearl button is in dark.
  "create",
  "create-foreground",
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
  // The Moonstone layer (docs/features/themes.md, "The look"): light behind
  // the page, floating chrome, the four block cards, chip tints and avatar
  // tints. All derived from the five roles plus the optional glow colour.
  "glow",
  "haze",
  "raised",
  "muted-strong",
  "thumb",
  "chrome",
  "chrome-foreground",
  "chrome-accent",
  "chrome-accent-foreground",
  "block-quiet",
  "block-quiet-foreground",
  "block-quiet-meta",
  "block-alert",
  "block-alert-foreground",
  "block-alert-meta",
  "block-answer",
  "block-answer-foreground",
  "block-answer-meta",
  "block-goal",
  "block-goal-foreground",
  "block-goal-meta",
  "tint-danger",
  "tint-danger-foreground",
  "tint-accent",
  "tint-accent-foreground",
  "tint-success",
  "tint-success-foreground",
  "tint-info",
  "tint-info-foreground",
  "avatar-1",
  "avatar-1-foreground",
  "avatar-2",
  "avatar-2-foreground",
  "avatar-3",
  "avatar-3-foreground",
  "avatar-4",
  "avatar-4-foreground",
  "avatar-5",
  "avatar-5-foreground",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type TokenMap = Record<TokenName, string>;

export interface DerivedTheme {
  light: TokenMap;
  dark: TokenMap;
}

/** Text/icons on a fill: AA for normal text, with a hair of margin for rounding. */
export const TEXT_TARGET = 4.6;
/** Non-text (focus ring, chart marks): WCAG 1.4.11. */
export const GRAPHIC_TARGET = 3.05;

const WHITE = "#ffffff";
const BLACK = "#000000";

/**
 * The foreground for text on `fill`: the palette's own text or background
 * colour when one of them reads, else plain white or black.
 */
export function onFill(fill: string, palette: readonly string[]): string {
  const preferred = bestContrast(fill, palette);
  if (contrastRatio(preferred, fill) >= TEXT_TARGET) return preferred;
  const pure = bestContrast(fill, [WHITE, BLACK]);
  return contrastRatio(pure, fill) > contrastRatio(preferred, fill) ? pure : preferred;
}

/** Adjusts `color` until it clears `target` against every one of `grounds`. */
export function readableOn(color: string, grounds: readonly string[], target: number): string {
  let result = color;
  // Two passes: fixing against one ground can undo another only marginally.
  for (let pass = 0; pass < 2; pass++) {
    for (const ground of grounds) result = adjustForContrast(result, ground, target);
  }
  return result;
}

/** A tint of `ground` towards `tint` that keeps `text` readable on it. */
export function readableTint(ground: string, tint: string, amount: number, text: string): string {
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

/** Options beyond the five roles. */
export interface DeriveOptions {
  /**
   * The glow: the colour of the light behind the page (Look and feel, or a
   * preset's own, e.g. Moonstone's banana). Null or absent: the accent.
   */
  glow?: string | null;
}

/** A tint of `surface` towards `color`, and an ink for text on it (>= 4.6:1 on the tint and the surface). */
function tintPair(surface: string, color: string, amount: number, dark: boolean): [string, string] {
  const tint = mixOklab(surface, color, amount);
  const c = hexToOklch(color);
  const start = dark
    ? oklchToHex({ L: Math.max(c.L, 0.8), C: Math.min(c.C, 0.16), h: c.h })
    : oklchToHex({ L: Math.min(c.L, 0.5), C: c.C, h: c.h });
  return [tint, readableOn(start, [tint, surface], TEXT_TARGET)];
}

/** The quiet label on a block: its foreground mixed towards the block, still readable. */
function blockMeta(foreground: string, block: string): string {
  return readableOn(mixOklab(foreground, block, 0.3), [block], TEXT_TARGET);
}

/** A white-label block in a fixed hue family, darkened until white text reads on it. */
function whiteLabelBlock(L: number, C: number, h: number): string {
  return adjustForContrast(oklchToHex({ L, C, h }), WHITE, TEXT_TARGET);
}

/** The full token map for one palette. */
export function deriveTokens(roles: ThemeRoles, options: DeriveOptions = {}): TokenMap {
  const { primary, accent, background, surface, text } = roles;
  const dark = !isLight(background);
  const palette = [text, background, surface];
  const glow = options.glow ?? accent;
  // No hue of its own in primary or accent (Moonstone, Graphite).
  const mono = hexToOklch(primary).C < 0.05 && hexToOklch(accent).C < 0.05;

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

  const [chart1, chart2, chart3, chart4, chart5] = deriveChartPalette(
    primary,
    dark ? "dark" : "light",
    [background, surface],
    { brands: [accent, glow], quiet: mono },
  );
  const charts = [chart1, chart2, chart3, chart4, chart5];

  // Elevation: in dark mode a surface one step up is lighter; in light mode
  // floats are white with a shadow.
  const raised = dark ? mixOklab(surface, text, 0.05) : mixOklab(surface, WHITE, 0.6);
  const mutedStrong = mixOklab(background, text, dark ? 0.2 : 0.12);
  const thumb = dark ? mixOklab(muted, text, 0.13) : surface;

  // Floating chrome (the collapsed sidebar, toasts, the phone menu button): near
  // black with the primary's hue in light mode, one step above the cards in dark.
  const p = hexToOklch(primary);
  const hueSource = p.C > 0.03 ? p : hexToOklch(background);
  const chrome = dark
    ? mixOklab(surface, text, 0.075)
    : oklchToHex({ L: 0.235, C: Math.min(hueSource.C, 0.035), h: hueSource.h });
  const chromeForeground = onFill(chrome, [text, background, surface, WHITE]);
  // The accent as it sits on the chrome (the active item on the rail): the
  // accent itself, unless it is about as dark
  // as the chrome (an ink accent in light mode); then the chrome's own label.
  const chromeAccent = contrastRatio(accent, chrome) >= 1.6 ? accent : chromeForeground;

  // The four block cards. Quiet comes from the chrome; it moves towards
  // mid-grey when it would read as the accent block (an ink or pearl accent).
  let quiet = dark ? mixOklab(surface, text, 0.08) : chrome;
  if (contrastRatio(quiet, accent) < 1.6) {
    quiet = dark ? mixOklab(surface, text, 0.2) : mixOklab(chrome, background, 0.38);
  }
  const quietForeground = onFill(quiet, palette);
  const alert = whiteLabelBlock(dark ? 0.52 : 0.54, 0.17, 30);
  const goal = whiteLabelBlock(dark ? 0.47 : 0.45, 0.085, 165);
  const answerForeground = onFill(accent, palette);
  const inkAccent = !dark && accent.toLowerCase() === text.toLowerCase();
  // A monochrome dark theme's accent is the pearl text colour, which reads
  // as grey on a button: create buttons go pure white there instead.
  const pearlAccent = dark && accent.toLowerCase() === text.toLowerCase();

  // Info notes take the brand colour, unless it sits near the danger red
  // (a coral or brick club), where an info note would read as an error:
  // then the second chart colour, or a plain blue if that is red too.
  const dangerHue = hexToOklch(destructive).h;
  const nearDanger = (hex: string) => {
    const c = hexToOklch(hex);
    const gap = Math.abs(((c.h - dangerHue + 540) % 360) - 180);
    return c.C >= 0.06 && gap < 35;
  };
  const info =
    p.C >= 0.1 && !nearDanger(primary)
      ? primary
      : !nearDanger(chart2)
        ? chart2
        : oklchToHex({ L: dark ? 0.7 : 0.55, C: 0.13, h: 250 });
  const [tintDanger, tintDangerInk] = tintPair(surface, destructive, dark ? 0.2 : 0.15, dark);
  const [tintAccent, tintAccentInk] = tintPair(surface, accent, dark ? 0.18 : 0.26, dark);
  const [tintSuccess, tintSuccessInk] = tintPair(surface, success, dark ? 0.2 : 0.15, dark);
  const [tintInfo, tintInfoInk] = tintPair(surface, info, dark ? 0.2 : 0.15, dark);
  const avatars = charts.map((c) => tintPair(surface, c, dark ? 0.26 : 0.2, dark));

  return {
    background,
    foreground: text,
    card: surface,
    "card-foreground": text,
    popover: dark ? raised : surface,
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
    "brand-accent-foreground": answerForeground,
    create: inkAccent ? surface : pearlAccent ? WHITE : accent,
    "create-foreground": inkAccent ? text : pearlAccent ? background : answerForeground,
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
    glow,
    haze: mono ? primary : chart2,
    raised,
    "muted-strong": mutedStrong,
    thumb,
    chrome,
    "chrome-foreground": chromeForeground,
    "chrome-accent": chromeAccent,
    "chrome-accent-foreground": onFill(chromeAccent, [chrome, text, background, surface]),
    "block-quiet": quiet,
    "block-quiet-foreground": quietForeground,
    "block-quiet-meta": blockMeta(quietForeground, quiet),
    "block-alert": alert,
    "block-alert-foreground": WHITE,
    "block-alert-meta": blockMeta(WHITE, alert),
    "block-answer": accent,
    "block-answer-foreground": answerForeground,
    "block-answer-meta": blockMeta(answerForeground, accent),
    "block-goal": goal,
    "block-goal-foreground": WHITE,
    "block-goal-meta": blockMeta(WHITE, goal),
    "tint-danger": tintDanger,
    "tint-danger-foreground": tintDangerInk,
    "tint-accent": tintAccent,
    "tint-accent-foreground": tintAccentInk,
    "tint-success": tintSuccess,
    "tint-success-foreground": tintSuccessInk,
    "tint-info": tintInfo,
    "tint-info-foreground": tintInfoInk,
    "avatar-1": avatars[0][0],
    "avatar-1-foreground": avatars[0][1],
    "avatar-2": avatars[1][0],
    "avatar-2-foreground": avatars[1][1],
    "avatar-3": avatars[2][0],
    "avatar-3-foreground": avatars[2][1],
    "avatar-4": avatars[3][0],
    "avatar-4-foreground": avatars[3][1],
    "avatar-5": avatars[4][0],
    "avatar-5-foreground": avatars[4][1],
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

/**
 * Both modes' tokens. `dark` null means "derive it from light". The glow
 * (one colour for both modes) defaults to each mode's own accent.
 */
export function deriveTheme(
  light: ThemeRoles,
  dark: ThemeRoles | null,
  glow: string | null = null,
): DerivedTheme {
  return {
    light: deriveTokens(light, { glow }),
    dark: deriveTokens(dark ?? deriveDarkRoles(light), { glow }),
  };
}
