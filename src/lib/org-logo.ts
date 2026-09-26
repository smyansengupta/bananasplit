/**
 * The org logo stored on Organization.logo by the logo upload route:
 * { key, s64, s256, s512, updatedAt }, each sNN a public URL of a WebP
 * variant fitted inside an NN x NN box. Pure and client-safe.
 */

export type OrgLogoSize = 64 | 256 | 512;

export interface OrgLogoVariants {
  s64: string;
  s256: string;
  s512: string;
}

function isUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("/") || value.startsWith("https://"));
}

/** The logo's variant URLs, or null when there is no (valid) logo. */
export function orgLogoVariants(logo: unknown): OrgLogoVariants | null {
  if (!logo || typeof logo !== "object") return null;
  const l = logo as Record<string, unknown>;
  if (!isUrl(l.s64) || !isUrl(l.s256) || !isUrl(l.s512)) return null;
  return { s64: l.s64, s256: l.s256, s512: l.s512 };
}

/** The smallest variant at least `px` wide, or null. */
export function orgLogoUrl(logo: unknown, px: number = 64): string | null {
  const v = orgLogoVariants(logo);
  if (!v) return null;
  if (px <= 64) return v.s64;
  if (px <= 256) return v.s256;
  return v.s512;
}
