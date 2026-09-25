/**
 * Avatar helpers shared by UserAvatar and the org chart. Pure and
 * client-safe.
 *
 * User.avatar (Phase 2) holds { key, s64, s128, s256, updatedAt }: the
 * public URLs of re-encoded square WebP variants (src/server/images). The
 * fallback order is: uploaded avatar, then the OAuth profile image, then
 * initials.
 */

export const AVATAR_VARIANTS = [64, 128, 256] as const;

export type AvatarVariants = Partial<Record<`s${(typeof AVATAR_VARIANTS)[number]}`, string>>;

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

/** The usable variant URLs in a User.avatar value (anything malformed is ignored). */
export function parseAvatarVariants(avatar: unknown): AvatarVariants {
  if (!avatar || typeof avatar !== "object") return {};
  const out: AvatarVariants = {};
  for (const size of AVATAR_VARIANTS) {
    const url = (avatar as Record<string, unknown>)[`s${size}`];
    if (isImageUrl(url)) out[`s${size}`] = url;
  }
  return out;
}

export interface AvatarSource {
  src: string;
  srcSet?: string;
}

/**
 * The image to show at `px` CSS pixels: the smallest uploaded variant that
 * covers 1x, a srcSet with a 2x candidate, else the OAuth image, else null.
 */
export function avatarSource(
  user: { avatar?: unknown; image?: string | null },
  px: number,
): AvatarSource | null {
  const variants = parseAvatarVariants(user.avatar);
  const available = AVATAR_VARIANTS.filter((s) => variants[`s${s}`]);
  if (available.length > 0) {
    const pick = (target: number) =>
      available.find((s) => s >= target) ?? available[available.length - 1];
    const one = pick(px);
    const two = pick(px * 2);
    const src = variants[`s${one}`] as string;
    const srcSet = two !== one ? `${src} 1x, ${variants[`s${two}`]} 2x` : undefined;
    return { src, srcSet };
  }
  if (user.image && isImageUrl(user.image)) return { src: user.image };
  return null;
}

/** Up to two initials from a name, else from the email's local part, else "?". */
export function initialsOf(name?: string | null, email?: string | null): string {
  const source = name?.trim() || email?.split("@")[0]?.trim() || "";
  if (!source) return "?";
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length >= 2
      ? [words[0][0], words[words.length - 1][0]]
      : [...(words[0] ?? source)].slice(0, 2);
  return letters.join("").toUpperCase() || "?";
}
