import { deriveDarkRoles, deriveTheme, type DerivedTheme } from "./derive";
import { CUSTOM_PRESET_ID, DEFAULT_PRESET, findPreset } from "./presets";
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

export const DEFAULT_RESOLVED_THEME: ResolvedTheme = buildResolved({
  preset: DEFAULT_PRESET.id,
  mode: "SYSTEM",
  lockMode: false,
  logoDisplay: "LOGO_AND_NAME",
  light: DEFAULT_PRESET.light,
  dark: DEFAULT_PRESET.dark,
  isDefault: true,
});

function buildResolved(input: Omit<ResolvedTheme, "effectiveDark" | "tokens">): ResolvedTheme {
  const effectiveDark = input.dark ?? deriveDarkRoles(input.light);
  return { ...input, effectiveDark, tokens: deriveTheme(input.light, effectiveDark) };
}

export function resolveTheme(row: OrgThemeRowLike | null | undefined): ResolvedTheme {
  if (!row) return DEFAULT_RESOLVED_THEME;
  const light = parseRoles(row.light);
  if (!light) return DEFAULT_RESOLVED_THEME;
  const mode = asMode(row.mode);
  const preset = findPreset(row.preset) ? row.preset : CUSTOM_PRESET_ID;
  return buildResolved({
    preset,
    mode,
    lockMode: row.lockMode && mode !== "SYSTEM",
    logoDisplay: asLogoDisplay(row.logoDisplay),
    light,
    dark: parseRoles(row.dark),
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
