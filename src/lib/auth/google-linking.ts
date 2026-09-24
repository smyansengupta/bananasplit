import type { Adapter, AdapterUser } from "next-auth/adapters";

import { normalizeEmail, sameEmail } from "@/lib/auth/normalize-email";
import { squatterStore, verifiedGoogleEmail } from "@/lib/auth/purge-squatter";
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
 * 5. The user's emailVerified is set from the verified Google profile
 *    (0A Fix 4(b)). Auth.js creates OAuth users with emailVerified NULL, so
 *    the adapter does it at creation: the Google profile() callback marks
 *    the user it hands Auth.js with the verified address (googleProfile),
 *    and withNormalizedEmails' createUser strips the marker and stores
 *    emailVerified when it matches the address being created. A returning
 *    or email-linked user is marked after sign-in (markGoogleEmailVerified,
 *    the signIn event). A brand-new Google user is therefore verified from
 *    the first row, never observable as unverified.
 *
 * The gate fails closed: if the purge or the password strip throws, the
 * sign-in is refused. With email linking on, letting it through would link
 * the Google identity to the squatter's account.
 */

interface GoogleProfile {
  email?: string | null;
  email_verified?: boolean | string | null;
}

/** The marker googleProfile() adds for the adapter (never stored). */
export const VERIFIED_EMAIL_MARKER = "googleVerifiedEmail";

/**
 * The Google provider's profile(): Auth.js's default OIDC mapping plus the
 * verified address (normalized), or null when Google did not verify it.
 */
export function googleProfile(profile: GoogleProfile & {
  sub?: string;
  name?: string | null;
  picture?: string | null;
}) {
  return {
    id: profile.sub ?? crypto.randomUUID(),
    name: profile.name ?? null,
    email: profile.email ?? null,
    image: profile.picture ?? null,
    [VERIFIED_EMAIL_MARKER]: verifiedGoogleEmail({ account: { provider: "google" }, profile }),
  };
}

export const googleProviderOptions = {
  authorization: { params: { scope: "openid email profile" } },
  allowDangerousEmailAccountLinking: true,
  profile: googleProfile,
} as const;

/**
 * The Auth.js signIn callback for OAuth providers. Returns true to continue,
 * or false to refuse (Auth.js then redirects with error=AccessDenied).
 */
export async function googleSignInGate(params: {
  account?: { provider?: string } | null;
  profile?: GoogleProfile | null;
}): Promise<boolean> {
  if (params.account?.provider !== "google") return true;

  const email = verifiedGoogleEmail(params);
  if (!email) return false;

  const purged = await squatterStore.purge(email);
  if (purged > 0) {
    console.info("[auth] removed an unverified password account before a verified Google sign-in");
  }
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
  const email = verifiedGoogleEmail(params);
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
  const normalizeUser = <T extends Partial<AdapterUser>>(user: T): T => {
    const { [VERIFIED_EMAIL_MARKER]: _marker, ...rest } = user as T & Record<string, unknown>;
    const clean = rest as T;
    return typeof clean.email === "string" ? { ...clean, email: normalizeEmail(clean.email) } : clean;
  };
  return {
    ...adapter,
    createUser: adapter.createUser
      ? (user) => {
          const marker = (user as unknown as Record<string, unknown>)[VERIFIED_EMAIL_MARKER];
          const data = normalizeUser(user);
          // 0A Fix 4(b): a Google user whose address Google verified is
          // created verified (the marker comes only from googleProfile).
          const verified = typeof marker === "string" && sameEmail(marker, data.email);
          return adapter.createUser!(verified ? { ...data, emailVerified: new Date() } : data);
        }
      : undefined,
    getUserByEmail: adapter.getUserByEmail
      ? (email) => adapter.getUserByEmail!(normalizeEmail(email))
      : undefined,
    updateUser: adapter.updateUser
      ? (user) => adapter.updateUser!(normalizeUser(user))
      : undefined,
  };
}
