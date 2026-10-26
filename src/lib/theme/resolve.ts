import { withAccent } from "./accent";
import { deriveDarkRoles, deriveTheme, type DerivedTheme } from "./derive";
import {
  DEFAULT_PRESET_ID,
  UNTHEMED_PRESET,
  isFormerDefault,
  presetGlow,
  savedPresetId,
} from "./presets";
import { DEFAULT_THEME_STYLE, parseThemeStyle, type ThemeStyle } from "./style";
import {
  LOGO_DISPLAYS,
  THEME_MODES,
  type LogoDisplayValue,
  type ThemeModeValue,
  type ThemeRoles,
} from "./types";
import { parseRoles } from "./validate";

/**
 * An OrgTheme row (or its absence) resolved into what the app renders.
 * Isomorphic: the org layout, the public pages and the settings page all
 * resolve the same way. A row with an invalid palette falls back to the
 * default theme; an invalid dark palette falls back to the derived one.
 */

/** The OrgTheme columns this module reads (a Prisma row satisfies it). */
export interface OrgThemeRowLike {
  preset: string;
  mode: string;
  lockMode: boolean;
  logoDisplay?: string | null;
  light: unknown;
  dark: unknown;
  /** {light, dark, style?}: only `style` (Look and feel) is read; tokens are re-derived. */
  tokens?: unknown;
}

export interface ResolvedTheme {
  /** A known preset id or "custom". */
  preset: string;
  mode: ThemeModeValue;
  /** Only ever true with LIGHT or DARK (next-themes cannot force "system"). */
  lockMode: boolean;
  logoDisplay: LogoDisplayValue;
  light: ThemeRoles;
  /** The org's own dark palette; null when it is derived from light. */
  dark: ThemeRoles | null;
  /** The dark palette in effect (the org's own, or derived). */
  effectiveDark: ThemeRoles;
  /** Look and feel: accent and glow overrides, corners, text size, fonts. */
  style: ThemeStyle;
  /** The glow in effect: the style's, else the preset's, else null (each mode's accent). */
  glow: string | null;
  /** Derived from light / effectiveDark with the style's accent and the glow applied. */
  tokens: DerivedTheme;
  /** True when there is no row: the globals.css default applies and nothing is injected. */
  isDefault: boolean;
}

function asMode(value: string): ThemeModeValue {
  return (THEME_MODES as readonly string[]).includes(value) ? (value as ThemeModeValue) : "SYSTEM";
}

function asLogoDisplay(value: string | null | undefined): LogoDisplayValue {
  return value && (LOGO_DISPLAYS as readonly string[]).includes(value)
    ? (value as LogoDisplayValue)
    : "LOGO_AND_NAME";
}

// Graphite is light first: an org with no theme row opens on the white page.
// (Dark-first was Moonstone's rule, and Graphite in dark is all but
// indistinguishable from Moonstone in dark - which is how the default looked
// unchanged after it was switched.) A member's own stored choice still wins.
export const DEFAULT_RESOLVED_THEME: ResolvedTheme = buildResolved({
  preset: UNTHEMED_PRESET.id,
  mode: "LIGHT",
  lockMode: false,
  logoDisplay: "LOGO_AND_NAME",
  light: UNTHEMED_PRESET.light,
  dark: UNTHEMED_PRESET.dark,
  style: DEFAULT_THEME_STYLE,
  isDefault: true,
});

function buildResolved(
  input: Omit<ResolvedTheme, "effectiveDark" | "tokens" | "glow">,
): ResolvedTheme {
  const effectiveDark = input.dark ?? deriveDarkRoles(input.light);
  const effective = withAccent(input.light, effectiveDark, input.style.accent);
  const glow = input.style.glow ?? presetGlow(input.preset);
  return {
    ...input,
    effectiveDark,
    glow,
    tokens: deriveTheme(effective.light, effective.dark, glow),
  };
}

/** The palettes the app actually paints with: the theme's, with the style's accent on top. */
export function effectivePalettes(
  theme: Pick<ResolvedTheme, "light" | "effectiveDark" | "style">,
): {
  light: ThemeRoles;
  dark: ThemeRoles;
} {
  return withAccent(theme.light, theme.effectiveDark, theme.style.accent);
}

/** The Look and feel stored with a row (OrgTheme.tokens.style); the default when absent. */
export function rowStyle(tokens: unknown): ThemeStyle {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return DEFAULT_THEME_STYLE;
  return parseThemeStyle((tokens as Record<string, unknown>).style);
}

export function resolveTheme(row: OrgThemeRowLike | null | undefined): ResolvedTheme {
  if (!row) return DEFAULT_RESOLVED_THEME;
  const stored = parseRoles(row.light);
  if (!stored) return DEFAULT_RESOLVED_THEME;
  const mode = asMode(row.mode);
  // A former default (the raspberry or the cream Bananasplit) saved as
  // "default": follow the brand onto today's default, Graphite.
  const legacy = row.preset === DEFAULT_PRESET_ID && isFormerDefault(stored);
  const light = legacy ? UNTHEMED_PRESET.light : stored;
  const preset = savedPresetId(row.preset, light);
  return buildResolved({
    preset,
    mode,
    lockMode: row.lockMode && mode !== "SYSTEM",
    logoDisplay: asLogoDisplay(row.logoDisplay),
    light,
    dark: legacy ? UNTHEMED_PRESET.dark : parseRoles(row.dark),
    style: rowStyle(row.tokens),
    isDefault: false,
  });
}

/** next-themes props for the org's mode default and lock. */
export function themeProviderMode(theme: Pick<ResolvedTheme, "mode" | "lockMode">): {
  defaultTheme: "light" | "dark" | "system";
  forcedTheme: "light" | "dark" | undefined;
} {
  const defaultTheme = theme.mode === "LIGHT" ? "light" : theme.mode === "DARK" ? "dark" : "system";
  return {
    defaultTheme,
    forcedTheme: theme.lockMode && defaultTheme !== "system" ? defaultTheme : undefined,
  };
}
