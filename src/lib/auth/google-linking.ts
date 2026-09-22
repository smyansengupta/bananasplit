import type { Adapter, AdapterUser } from "next-auth/adapters";

import { normalizeEmail, sameEmail } from "@/lib/auth/normalize-email";
import { authDb } from "@/server/db/clients";

/**
 * Google sign-in and the email-squatting recovery (0A Fix 4(d)).
 *
 * Before 0A anyone could pre-register a password account under someone
 * else's address. The real owner then hit OAuthAccountNotLinked when they
 * signed in with Google and was locked out of their own email. Now:
 *
 * 1. A Google sign-in is accepted only when Google says the address is
 *    verified (profile.email_verified). Anything else is refused.
 * 2. Right before Auth.js links or creates the user, an UNVERIFIED
 *    credentials-only account holding that address (no Account, no
 *    Membership, no membership history) is deleted, through the definer
 *    function app.purge_unverified_users(email), which can see the tenant
 *    predicates app_auth cannot.
 * 3. An unverified account the purge had to keep (it joined an org before
 *    verification was required) loses its password: the verified owner of
 *    the address takes it over through Google, and the squatter can no
 *    longer sign in with the password they set.
 * 4. The Google provider allows email account linking, so a VERIFIED
 *    credentials user who signs in with Google is linked instead of locked
 *    out. That is safe only because both sides have verified the address.
 * 5. After sign-in, the user's emailVerified is set from the verified Google
 *    profile (Auth.js creates OAuth users with emailVerified NULL).
 */

export const googleProviderOptions = {
  authorization: { params: { scope: "openid email profile" } },
  allowDangerousEmailAccountLinking: true,
} as const;

interface GoogleProfile {
  email?: unknown;
  email_verified?: unknown;
}

function verifiedGoogleEmail(profile: GoogleProfile | null | undefined): string | null {
  if (!profile || profile.email_verified !== true || typeof profile.email !== "string") {
    return null;
  }
  return normalizeEmail(profile.email);
}

/**
 * The Auth.js signIn callback for OAuth providers. Returns true to continue,
 * or false to refuse (Auth.js then redirects with error=AccessDenied).
 */
export async function googleSignInGate(params: {
  account?: { provider?: string } | null;
  profile?: GoogleProfile | null;
}): Promise<boolean> {
  if (params.account?.provider !== "google") return true;

  const email = verifiedGoogleEmail(params.profile);
  if (!email) return false;

  await authDb.$queryRaw`SELECT app.purge_unverified_users(${email}) AS purged`;
  await authDb.userCredential.updateMany({
    where: { passwordHash: { not: null }, user: { email, emailVerified: null } },
    data: { passwordHash: null },
  });
  return true;
}

/** The Auth.js signIn event: record the verified Google address on the user. */
export async function markGoogleEmailVerified(params: {
  user?: { id?: string | null; email?: string | null } | null;
  account?: { provider?: string } | null;
  profile?: GoogleProfile | null;
}): Promise<void> {
  if (params.account?.provider !== "google" || !params.user?.id) return;
  const email = verifiedGoogleEmail(params.profile);
  if (!email || !sameEmail(email, params.user.email)) return;
  await authDb.user.updateMany({
    where: { id: params.user.id, email, emailVerified: null },
    data: { emailVerified: new Date() },
  });
}

/**
 * Wraps the Prisma adapter so every email it writes or looks up is
 * normalized, including addresses that arrive from an OAuth profile.
 */
export function withNormalizedEmails(adapter: Adapter): Adapter {
  const normalizeUser = <T extends Partial<AdapterUser>>(user: T): T =>
    typeof user.email === "string" ? { ...user, email: normalizeEmail(user.email) } : user;
  return {
    ...adapter,
    createUser: adapter.createUser
      ? (user) => adapter.createUser!(normalizeUser(user))
      : undefined,
    getUserByEmail: adapter.getUserByEmail
      ? (email) => adapter.getUserByEmail!(normalizeEmail(email))
      : undefined,
    updateUser: adapter.updateUser
      ? (user) => adapter.updateUser!(normalizeUser(user))
      : undefined,
  };
}
