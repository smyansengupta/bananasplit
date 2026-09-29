import { AuthError, CredentialsSignin } from "next-auth";

import { signIn } from "@/lib/auth/config";

/**
 * Email and password sign-in for the Server Actions (sign-in, sign-up),
 * telling a rejected password apart from a server that cannot sign anyone
 * in. The caller redirects on success.
 *
 * Auth.js has three ways out of signIn("credentials"):
 * - it throws CredentialsSignin when authorize() refuses (no such account,
 *   wrong password; code "rate_limited" when a sign-in limit is hit);
 * - it throws another AuthError when something breaks on the way
 *   (CallbackRouteError when authorize() itself throws, adapter and JWT
 *   errors);
 * - on a configuration error (MissingSecret, UntrustedHost, ...) it throws
 *   nothing: @auth/core answers with a 500 JSON body and no Location, and
 *   signIn() falls back to its own /api/auth/callback/credentials URL. With
 *   the default redirect that sends the browser to a page reading "There was
 *   a problem with the server configuration", which is how a production
 *   deployment without AUTH_SECRET looked. Hence redirect: false, and the
 *   check on the URL it returns.
 *
 * Only the first is the user's mistake. The others are logged with their
 * Auth.js type and reported as "unavailable".
 */

export type CredentialsSignInResult =
  { ok: true } | { ok: false; reason: "invalid" | "rate_limited" | "unavailable" };

/** What the forms show when the server cannot sign anyone in. */
export const SIGN_IN_UNAVAILABLE_MESSAGE =
  "Sign-in isn't available right now because of a problem on our end. Please try again later.";

/** Auth.js's own routes (basePath), never a destination after sign-in. */
const AUTH_ROUTES = "/api/auth/";

/**
 * Signs the user in (sets the session cookie) or says why not. `redirectTo`
 * must be a same-origin relative path; it is where the caller will send the
 * user, and Auth.js checks it as its callback URL.
 */
export async function credentialsSignIn(
  email: string,
  password: string,
  redirectTo: string,
): Promise<CredentialsSignInResult> {
  let location: unknown;
  try {
    location = await signIn("credentials", { email, password, redirectTo, redirect: false });
  } catch (error) {
    if (error instanceof CredentialsSignin) {
      return { ok: false, reason: error.code === "rate_limited" ? "rate_limited" : "invalid" };
    }
    if (error instanceof AuthError) {
      console.error(
        `[auth] credentials sign-in failed with ${error.type}, not a credentials rejection`,
      );
      return { ok: false, reason: "unavailable" };
    }
    throw error;
  }
  if (!signedInLocation(location)) {
    console.error(
      "[auth] credentials sign-in answered without a session: Auth.js configuration error (see the [auth][error] line, e.g. MissingSecret when AUTH_SECRET is not set)",
    );
    return { ok: false, reason: "unavailable" };
  }
  return { ok: true };
}

/** Whether signIn() returned a real post-sign-in destination (see above). */
function signedInLocation(location: unknown): boolean {
  if (typeof location !== "string" || location.length === 0) return false;
  try {
    return !new URL(location, "http://placeholder.invalid").pathname.startsWith(AUTH_ROUTES);
  } catch {
    return false;
  }
}
