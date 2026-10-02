import { redirect } from "next/navigation";

import { signOut } from "@/lib/auth/config";
import { getSession } from "@/lib/auth/session";
import { getOnboardingProfile } from "@/server/onboarding/profile";

/**
 * GET /auth/session-ended: where a session lands when its user no longer
 * exists (an account deleted while signed in, or a token minted against
 * another database). Sessions are signed tokens that pages trust without a
 * lookup, so without this such a session bounced between /sign-in, /app and
 * /onboarding until the browser gave up ("too many redirects"). Here it is
 * signed out and sent to sign-in with a short explanation.
 *
 * A session whose user does exist is left alone and sent home, so a link to
 * this route can't sign anyone out.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (session && (await getOnboardingProfile(session.user.id))) redirect("/app");
  await signOut({ redirectTo: "/sign-in?error=SessionEnded" });
}
