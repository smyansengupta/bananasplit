/** Kebab-case slug suitable for an org's URL segment. Pure and client-safe. */
export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "org";
}

/**
 * Slugs no org may use: route segments and platform words. The database
 * enforces the same list (app.reserved_slugs(), used by app.slug_available
 * and the organization_slug_guard trigger); `pnpm test:rls` asserts that the
 * two lists are identical, so change both together in one migration.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "admin",
  "api",
  "app",
  "invite",
  "new",
  "onboarding",
  "platform",
  "poll",
  "public",
  "settings",
  "sign-in",
  "sign-up",
];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug.trim().toLowerCase());
}
