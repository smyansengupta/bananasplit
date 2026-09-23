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

/** The stored (normalized) email and its verification state for a user. */
export async function getUserIdentity(userId: string): Promise<UserIdentity | null> {
  return authDb.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, emailVerified: true },
  });
}
