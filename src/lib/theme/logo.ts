/**
 * Organization.logo helpers (the JSON written by the logo upload:
 * { key, s64, s256, s512, updatedAt }, public WebP variants fitted inside
 * the box). Pure and client-safe; anything malformed is ignored.
 */

export const LOGO_VARIANTS = [64, 256, 512] as const;

function isImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export interface LogoSource {
  src: string;
  srcSet?: string;
}

/**
 * The logo for a box `px` CSS pixels tall: the smallest variant that covers
 * it, plus a srcSet so high-density screens pick a sharper one.
 */
export function orgLogoSource(logo: unknown, px: number): LogoSource | null {
  if (!logo || typeof logo !== "object") return null;
  const record = logo as Record<string, unknown>;
  const variants = LOGO_VARIANTS.map((size) => ({ size, url: record[`s${size}`] })).filter(
    (v): v is { size: (typeof LOGO_VARIANTS)[number]; url: string } => isImageUrl(v.url),
  );
  if (variants.length === 0) return null;
  const src = (variants.find((v) => v.size >= px) ?? variants[variants.length - 1]).url;
  const srcSet = variants.map((v) => `${v.url} ${v.size / px}x`).join(", ");
  return { src, srcSet };
}

/** Up to two initials for the monogram shown when an org has no logo. */
export function orgInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}
