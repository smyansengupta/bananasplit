import { z } from "zod";

import { deriveDarkRoles, deriveTheme } from "./derive";
import { CUSTOM_PRESET_ID, DEFAULT_PRESET_ID, findPreset } from "./presets";
import type { ResolvedTheme } from "./resolve";
import type { ThemeRoles } from "./types";
import { parseRoles, rolesSchema } from "./validate";

/**
 * A member's personal theme (onboarding A4, and the profile page). It only
 * changes that member's own view: the org layout swaps the palette for
 * theirs, but an org that LOCKS light or dark keeps its lock.
 *
 * Stored on User.themePreference as { preset, mode, custom? }: a preset id
 * from src/lib/theme/presets.ts or "custom" with five strict-hex colours
 * (the light palette; the dark one is derived). NULL = follow the org.
 */

export const PERSONAL_MODES = ["light", "dark", "system"] as const;
export type PersonalMode = (typeof PERSONAL_MODES)[number];

export const personalThemeSchema = z
  .object({
    preset: z.string().regex(/^[a-z0-9-]{1,32}$/),
    mode: z.enum(PERSONAL_MODES),
    custom: rolesSchema.nullable().optional(),
  })
  .strict()
  .refine((t) => t.preset === CUSTOM_PRESET_ID || findPreset(t.preset), {
    message: "Pick a theme from the list.",
    path: ["preset"],
  })
  .refine((t) => t.preset !== CUSTOM_PRESET_ID || Boolean(t.custom), {
    message: "Pick your five colours.",
    path: ["custom"],
  })
  .transform((t) => ({
    preset: t.preset,
    mode: t.mode,
    custom: t.preset === CUSTOM_PRESET_ID ? (t.custom ?? null) : null,
  }));

export type PersonalTheme = z.output<typeof personalThemeSchema>;

/** A stored value, or null (follow the org) when missing or malformed. */
export function parsePersonalTheme(raw: unknown): PersonalTheme | null {
  if (!raw) return null;
  const parsed = personalThemeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The light and dark palettes a personal theme stands for. */
export function personalPalettes(theme: PersonalTheme): { light: ThemeRoles; dark: ThemeRoles } | null {
  if (theme.preset === CUSTOM_PRESET_ID) {
    const light = parseRoles(theme.custom);
    return light ? { light, dark: deriveDarkRoles(light) } : null;
  }
  const preset = findPreset(theme.preset);
  return preset ? { light: preset.light, dark: preset.dark } : null;
}

/**
 * The org's resolved theme with the member's palette and mode on top. The
 * org keeps its logo display and any light/dark lock.
 */
export function applyPersonalTheme(org: ResolvedTheme, personal: PersonalTheme | null): ResolvedTheme {
  if (!personal) return org;
  const palettes = personalPalettes(personal);
  if (!palettes) return org;
  const mode = org.lockMode ? org.mode : personal.mode === "light" ? "LIGHT" : personal.mode === "dark" ? "DARK" : "SYSTEM";
  return {
    ...org,
    preset: personal.preset,
    mode,
    light: palettes.light,
    dark: palettes.dark,
    effectiveDark: palettes.dark,
    tokens: deriveTheme(palettes.light, palettes.dark),
    // The default preset is exactly globals.css: nothing to inject.
    isDefault: personal.preset === DEFAULT_PRESET_ID,
  };
}
