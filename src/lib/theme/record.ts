import { contrastWarnings, type ContrastWarning } from "./contrast";
import { deriveTheme, type DerivedTheme } from "./derive";
import { CUSTOM_PRESET_ID, findPreset } from "./presets";
import type { LogoDisplayValue, ThemeModeValue, ThemeRoles } from "./types";
import type { ThemeInput } from "./validate";

/**
 * What the save action writes to OrgTheme, from validated input. The server
 * is authoritative: a known preset id always stores that preset's own
 * palettes (whatever colours came with it), anything else is "custom";
 * a lock only sticks to LIGHT or DARK; tokens and warnings are recomputed
 * here, never taken from the client.
 */
export interface ThemeRecord {
  preset: string;
  mode: ThemeModeValue;
  lockMode: boolean;
  logoDisplay: LogoDisplayValue;
  light: ThemeRoles;
  dark: ThemeRoles | null;
  tokens: DerivedTheme;
  contrastWarnings: ContrastWarning[];
}

export function buildThemeRecord(input: ThemeInput): ThemeRecord {
  const preset = input.preset === CUSTOM_PRESET_ID ? undefined : findPreset(input.preset);
  const light = preset ? preset.light : input.light;
  const dark = preset ? preset.dark : input.dark;
  return {
    preset: preset ? preset.id : CUSTOM_PRESET_ID,
    mode: input.mode,
    lockMode: input.lockMode && input.mode !== "SYSTEM",
    logoDisplay: input.logoDisplay,
    light,
    dark,
    tokens: deriveTheme(light, dark),
    contrastWarnings: contrastWarnings(light, dark),
  };
}
