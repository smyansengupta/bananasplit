/**
 * TEMPORARY, with src/components/shell/capsule-variants.tsx: which shape of
 * the floating bar to draw.
 *
 * Its own module, and not in the component file, because the layout and the
 * switcher route are server code: a "use client" module's functions cannot be
 * called from the server, only rendered.
 *
 * Goes when a shape is chosen.
 */

export const CAPSULE_VARIANT_IDS = ["current", "command", "context", "quiet"] as const;
export type CapsuleVariant = (typeof CAPSULE_VARIANT_IDS)[number];

export const CAPSULE_COOKIE = "capsule_variant";

export function isCapsuleVariant(value: unknown): value is CapsuleVariant {
  return (
    typeof value === "string" && (CAPSULE_VARIANT_IDS as readonly string[]).includes(value)
  );
}
