import { normalizeEmail } from "@/lib/auth/normalize-email";
import { authDb } from "@/server/db/clients";

/**
 * Squatting recovery (0A Fix 4(d)): the SQL path and the verified-address
 * check used by googleSignInGate (./google-linking.ts), the Auth.js signIn
 * callback.
 *
 * Anyone can create a credentials account for an address they do not own,
 * and the address's real owner would then be locked out of Google sign-in
 * (OAuthAccountNotLinked). So when Google vouches for an address
 * (email_verified) we delete any credentials account for it that was never
 * verified and has no Google account, no membership and no membership
 * history, before Auth.js looks the address up; Auth.js then creates the
 * real owner's account. The predicates live in the SECURITY DEFINER
 * app.purge_unverified_users(email), executable by app_auth only (the auth
 * role cannot read Membership itself).
 *
 * A verified credentials account is never touched: its owner proved the
 * address, so the lockout is a normal "sign in with your password" case.
 */

interface GoogleSignIn {
  account?: { provider?: string | null } | null;
  profile?: { email?: string | null; email_verified?: boolean | string | null } | null;
}

/** Test seam: the SQL call. */
export const squatterStore = {
  async purge(email: string): Promise<number> {
    const rows = await authDb.$queryRaw<{ n: number }[]>`
      SELECT app.purge_unverified_users(${email}) AS n`;
    return Number(rows[0]?.n ?? 0);
  },
};

/** The verified Google address of a sign-in (normalized), or null. */
export function verifiedGoogleEmail(input: GoogleSignIn): string | null {
  if (input.account?.provider !== "google") return null;
  const verified = input.profile?.email_verified;
  if (verified !== true && verified !== "true") return null;
  const raw = input.profile?.email;
  if (typeof raw !== "string") return null;
  const email = normalizeEmail(raw);
  return email.includes("@") ? email : null;
}
