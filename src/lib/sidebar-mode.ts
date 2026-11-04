/**
 * The sidebar's mode (the Moonstone shell): docked, the labeled sidebar
 * along the window's edge (the default), or rail, collapsed into a glass
 * strip of icons. Peek, the labeled sidebar floating over the page while the
 * pointer rests on the rail, is a moment, never stored.
 *
 * Remembered per member in a cookie that the org layout reads, so the server
 * renders the right mode and the first paint never jumps. The cookie's name
 * carries a short hash of the user's id, so two people sharing a browser each
 * keep their own. It's a display preference with nothing to protect: the
 * shell writes it from the browser (document.cookie) and the layout reads it
 * with next/headers (src/lib/sidebar-mode-cookie.ts). Pure and client-safe.
 */

export const SIDEBAR_MODES = ["docked", "rail"] as const;
export type SidebarMode = (typeof SIDEBAR_MODES)[number];

export const DEFAULT_SIDEBAR_MODE: SidebarMode = "docked";

/** A year, like the active-org cookie. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const COOKIE_PREFIX = "sidebar_";

/** FNV-1a (32-bit) in base 36: a short, stable, cookie-safe key for a user id. */
export function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** The member's sidebar cookie: `sidebar_` and a hash of their user id. */
export function sidebarCookieName(userId: string): string {
  return `${COOKIE_PREFIX}${shortHash(userId)}`;
}

/** A stored value as a mode: anything but "rail" (missing, edited, old) is docked. */
export function parseSidebarMode(raw: string | null | undefined): SidebarMode {
  return raw?.trim() === "rail" ? "rail" : DEFAULT_SIDEBAR_MODE;
}

/** The document.cookie assignment that stores `mode` under `name`. */
export function serializeSidebarCookie(name: string, mode: SidebarMode, secure: boolean): string {
  const parts = [
    `${name}=${mode}`,
    "Path=/",
    `Max-Age=${SIDEBAR_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
