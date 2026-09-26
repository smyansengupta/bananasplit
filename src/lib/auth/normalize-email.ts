/**
 * Every email is stored and compared as lower(btrim(email)) (0A Fix 4(a),
 * migration 0a_normalize_emails): sign-up, credentials sign-in, the Auth.js
 * adapter, invitations and the platform-admin list all go through this, so
 * "Alice@Example.edu " and "alice@example.edu" are the same identity.
 * Client-safe.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Case- and whitespace-insensitive equality of two addresses. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return normalizeEmail(a) === normalizeEmail(b);
}
