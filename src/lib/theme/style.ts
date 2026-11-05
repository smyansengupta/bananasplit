import { normalizeHex } from "./hex";

/**
 * A theme's look beyond its colours (Settings > Theme > Look and feel): an
 * optional accent colour on top of the palette, corner roundness, text size
 * and the type pairing. Zod-free and pure, so the editor, the live preview
 * and the server renderer all read it the same way.
 *
 * Stored with the theme (OrgTheme.tokens.style, next to the derived tokens).
 * Rows saved before these options existed have no `style` and read as
 * DEFAULT_THEME_STYLE, which is exactly the look they had.
 *
 * Every CSS value comes from the fixed tables below, keyed by an enum: no
 * stored string ever reaches a <style> element except a strict hex accent,
 * which goes through the token pipeline (derive.ts, css.ts) like any colour.
 */

export const RADIUS_OPTIONS = ["sharp", "soft", "round"] as const;
export type RadiusOption = (typeof RADIUS_OPTIONS)[number];

export const TEXT_SIZE_OPTIONS = ["small", "default", "large"] as const;
export type TextSizeOption = (typeof TEXT_SIZE_OPTIONS)[number];

// "display" (Bricolage Grotesque) is the redesign's heading face. "serif" is
// kept for rows saved before it, when the serif was the default and so said
// nothing about a choice: it reads as "display". "young-serif" is the
// deliberate choice of Young Serif from now on.
export const HEADING_FONT_OPTIONS = ["display", "young-serif", "sans"] as const;
export type HeadingFontOption = (typeof HEADING_FONT_OPTIONS)[number];

export const BODY_FONT_OPTIONS = ["grotesk", "system"] as const;
export type BodyFontOption = (typeof BODY_FONT_OPTIONS)[number];

export interface ThemeStyle {
  /** Replaces the palette's accent in both modes; null keeps the palette's own. */
  accent: string | null;
  /** The glow (the light behind the page, halos on the active item and focus); null keeps the preset's, else the accent. */
  glow: string | null;
  radius: RadiusOption;
  textSize: TextSizeOption;
  headingFont: HeadingFontOption;
  bodyFont: BodyFontOption;
}

export const DEFAULT_THEME_STYLE: ThemeStyle = {
  accent: null,
  glow: null,
  radius: "round",
  textSize: "default",
  headingFont: "display",
  bodyFont: "grotesk",
};

/**
 * --radius per option (globals.css scales the shadcn rounded-* utilities from
 * it) and --radius-scale (the redesign's corner scale: 32 shell, 28 card,
 * 24 block, 18 tile, 14 field, times this). "round" is the default.
 */
export const RADIUS_VALUES: Record<RadiusOption, string> = {
  sharp: "0.25rem",
  soft: "0.5rem",
  round: "0.875rem",
};

export const RADIUS_SCALES: Record<RadiusOption, string> = {
  sharp: "0.4",
  soft: "0.7",
  round: "1",
};

/** The root font size: every rem (text and spacing) scales with it, so it doubles as density. */
export const TEXT_SIZE_VALUES: Record<TextSizeOption, string> = {
  small: "93.75%",
  default: "100%",
  large: "106.25%",
};

/** As a zoom factor, for the scoped preview (rem cannot be scoped to a box). */
export const TEXT_SIZE_ZOOM: Record<TextSizeOption, number> = {
  small: 0.9375,
  default: 1,
  large: 1.0625,
};

export const RADIUS_LABELS: Record<RadiusOption, { label: string; hint: string }> = {
  sharp: { label: "Sharp", hint: "Nearly square corners. Crisp and formal." },
  soft: { label: "Soft", hint: "Gently rounded corners." },
  round: {
    label: "Round",
    hint: "Generous curves on cards and fields, pill buttons. The default.",
  },
};

export const TEXT_SIZE_LABELS: Record<TextSizeOption, { label: string; hint: string }> = {
  small: { label: "Compact", hint: "Slightly smaller text and tighter spacing." },
  default: { label: "Default", hint: "The standard size." },
  large: { label: "Large", hint: "Bigger text and roomier spacing. Easier to read." },
};

export const HEADING_FONT_LABELS: Record<HeadingFontOption, { label: string; hint: string }> = {
  display: {
    label: "Bricolage",
    hint: "Bricolage Grotesque for page titles and big numbers. The default.",
  },
  "young-serif": { label: "Serif", hint: "Young Serif for page titles and big numbers." },
  sans: { label: "Sans", hint: "Hanken Grotesk, bold, for a plainer look." },
};

export const BODY_FONT_LABELS: Record<BodyFontOption, { label: string; hint: string }> = {
  grotesk: { label: "Hanken Grotesk", hint: "The Bananasplit typeface." },
  system: { label: "Device font", hint: "Each member's system font (San Francisco, Segoe UI…)." },
};

function pick<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Reads a stored style. Field by field: a bad or missing field takes its
 * default and the rest are kept, so an older or partly malformed row still
 * renders as close to what was saved as possible.
 */
export function parseThemeStyle(value: unknown): ThemeStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_THEME_STYLE;
  const record = value as Record<string, unknown>;
  const d = DEFAULT_THEME_STYLE;
  return {
    accent: normalizeHex(record.accent),
    glow: normalizeHex(record.glow),
    radius: pick(RADIUS_OPTIONS, record.radius, d.radius),
    textSize: pick(TEXT_SIZE_OPTIONS, record.textSize, d.textSize),
    // A stored "serif" predates the choice (it was the default): Bricolage.
    headingFont: pick(
      HEADING_FONT_OPTIONS,
      record.headingFont === "serif" ? "display" : record.headingFont,
      d.headingFont,
    ),
    bodyFont: pick(BODY_FONT_OPTIONS, record.bodyFont, d.bodyFont),
  };
}

export function sameStyle(a: ThemeStyle, b: ThemeStyle): boolean {
  return (
    a.accent === b.accent &&
    a.glow === b.glow &&
    a.radius === b.radius &&
    a.textSize === b.textSize &&
    a.headingFont === b.headingFont &&
    a.bodyFont === b.bodyFont
  );
}

export function isDefaultStyle(style: ThemeStyle): boolean {
  return sameStyle(style, DEFAULT_THEME_STYLE);
}

/**
 * The custom properties (and root font size) a style sets, from the fixed
 * tables only. The fonts point the next/font variables (set on <html> by
 * the root layout) at another loaded face, so every font-heading /
 * font-sans utility follows without new font downloads:
 * - headings "sans": --font-young-serif becomes the grotesk, bold;
 * - body "system": --font-hanken becomes the device's UI font.
 */
export function styleDeclarations(style: ThemeStyle): Record<string, string> {
  const out: Record<string, string> = {};
  if (style.radius !== DEFAULT_THEME_STYLE.radius) {
    out["--radius"] = RADIUS_VALUES[style.radius];
    out["--radius-scale"] = RADIUS_SCALES[style.radius];
  }
  if (style.bodyFont === "system") {
    out["--font-hanken"] =
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  }
  if (style.headingFont === "young-serif") {
    out["--font-display"] = "var(--font-young-serif)";
    out["--heading-weight"] = "400";
  }
  if (style.headingFont === "sans") {
    out["--font-display"] =
      style.bodyFont === "system"
        ? 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
        : "var(--font-hanken)";
    out["--heading-weight"] = "700";
  }
  return out;
}

/**
 * The style as a stylesheet for the org's pages: `html:root{...}`, which
 * beats globals.css (:root) and next/font's class on <html>. "" for the
 * default style (nothing to change).
 */
export function lookStyleSheet(style: ThemeStyle): string {
  const declarations = Object.entries(styleDeclarations(style)).map(([k, v]) => `${k}:${v}`);
  if (style.textSize !== DEFAULT_THEME_STYLE.textSize) {
    declarations.push(`font-size:${TEXT_SIZE_VALUES[style.textSize]}`);
  }
  return declarations.length > 0 ? `html:root{${declarations.join(";")}}` : "";
}
