import { createHash, randomBytes } from "node:crypto";

/**
 * Per-guest edit key for public poll responses (0A Fix 6). Each guest gets
 * an httpOnly cookie poll_guest_<pollId> holding 32 random bytes; only its
 * sha256 is stored (PollResponse.guestKeyHash), and a guest's
 * delete-then-recreate is scoped to that hash. Typing someone else's name
 * therefore creates a new respondent instead of replacing theirs, and legacy
 * guest rows (no hash) are read-only.
 */

export const GUEST_KEY_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export function guestCookieName(pollId: string): string {
  return `poll_guest_${pollId}`;
}

/** Scoped to the public poll page, where its Server Action posts. */
export function guestCookiePath(pollId: string): string {
  return `/poll/${pollId}`;
}

export function generateGuestKey(): string {
  return randomBytes(32).toString("base64url");
}

/** 32 random bytes, base64url: exactly 43 characters of [A-Za-z0-9_-]. */
export function isWellFormedGuestKey(value: string | undefined | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function hashGuestKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}
