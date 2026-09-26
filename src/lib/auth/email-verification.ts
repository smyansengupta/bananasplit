import { authDb } from "@/server/db/clients";

/**
 * The account's verification state (0A Fix 4(c)). An address is trusted
 * only once its owner has opened a link sent to it; until then the account
 * can sign in but cannot hold a Membership (no org creation, no invitation
 * acceptance). Callers compare against the STORED (normalized) email, never
 * the session's copy.
 *
 * Minting, mailing and consuming the link live in
 * src/server/email/verification.ts (the verify-email job and the
 * /verify-email/[token] page). Runs as app_auth (authDb), the identity role.
 */

export interface UserIdentity {
  id: string;
  email: string;
  emailVerified: Date | null;
}

/**
 * Whether an address has to be confirmed before it can hold a Membership.
 *
 * Off for local development, where no sender is configured and the link only
 * lands in .data/mail, so "Check your email" would be a dead end. Set
 * AUTH_REQUIRE_EMAIL_VERIFICATION=true to keep the gate on anyway, or
 * =false to turn it off, which is refused on a deployment (VERCEL_ENV set)
 * and whenever a sender exists: a live deployment always verifies.
 */
export function emailVerificationRequired(): boolean {
  const deployed = Boolean(process.env.VERCEL_ENV) || process.env.NODE_ENV === "production";
  const hasSender = Boolean(process.env.RESEND_API_KEY);
  const flag = process.env.AUTH_REQUIRE_EMAIL_VERIFICATION;
  if (flag === "true") return true;
  if (flag === "false" && !deployed && !hasSender) return false;
  return deployed || hasSender;
}

/**
 * The stored (normalized) email and its verification state for a user. When
 * verification is not required (local development), the address reports as
 * verified, so every gate built on this - onboarding, org creation, invite
 * acceptance - lets the developer through.
 */
export async function getUserIdentity(userId: string): Promise<UserIdentity | null> {
  const identity = await authDb.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true },
  });
  if (!identity || identity.emailVerified || emailVerificationRequired()) return identity;
  return { ...identity, emailVerified: new Date(0) };
}
