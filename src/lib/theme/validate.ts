import { z } from "zod";

import { HEX_RE, normalizeHex } from "./hex";
import { LOGO_DISPLAYS, ROLE_KEYS, THEME_MODES, type ThemeRoles } from "./types";

/** Strict hex lives in ./hex (zod-free, for client code); re-exported here. */
export { HEX_RE, isHex, normalizeHex } from "./hex";

export const hexSchema = z
  .string()
  .regex(HEX_RE, "Use a six-digit hex colour like #a34a2a.")
  .transform((value) => value.toLowerCase());

export const rolesSchema = z
  .object({
    primary: hexSchema,
    accent: hexSchema,
    background: hexSchema,
    surface: hexSchema,
    text: hexSchema,
  })
  .strict();

/** Preset ids: a short slug. Unknown ids are stored as "custom" by the action. */
export const presetIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);

/** What Settings > Theme submits. */
export const themeInputSchema = z
  .object({
    preset: presetIdSchema,
    mode: z.enum(THEME_MODES),
    lockMode: z.boolean(),
    logoDisplay: z.enum(LOGO_DISPLAYS),
    light: rolesSchema,
    /** null = derive the dark palette from the light one. */
    dark: rolesSchema.nullable(),
  })
  .strict();

export type ThemeInput = z.infer<typeof themeInputSchema>;

/**
 * Reads a stored palette (OrgTheme.light / .dark JSON). Every role must be
 * present and strict hex; anything else returns null so the caller falls
 * back (to the default theme, or to the derived dark palette).
 */
export function parseRoles(value: unknown): ThemeRoles | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const roles = {} as ThemeRoles;
  for (const key of ROLE_KEYS) {
    const hex = normalizeHex(record[key]);
    if (!hex) return null;
    roles[key] = hex;
  }
  return roles;
}
