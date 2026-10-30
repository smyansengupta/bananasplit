import type { Metadata } from "next";
import { SignedInAs } from "@/components/auth/signed-in-as";
import { AlreadySignedIn } from "@/components/auth/already-signed-in";
import { BrandGoogleButton } from "@/components/auth/google-sign-in-button";
import { AuthCard, AuthTitle } from "@/components/brand/auth-card";
import { FormMessage, OrDivider } from "@/components/brand/fields";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { auth } from "@/lib/auth/config";
import { googleSignInEnabled } from "@/lib/auth/google-sign-in";
import {
  FALLBACK_CARDS,
  shareMetadata,
  SIGN_IN_CARD,
  signInPreviewFor,
} from "@/lib/metadata/share";

import { PasswordSignInForm } from "./password-sign-in-form";

/**
 * A plain link to the log-in page previews as "Welcome back". A link to
 * anything behind sign-in, opened signed out (as whatever unfurls a texted
 * link is), lands here with its path in ?callbackUrl= and previews as the
 * main Bananasplit card instead, or as the join card for an old ?code= join
 * link (signInPreviewFor). The tab still says "Log in".
 */
export async function generateMetadata({ searchParams }: PageProps<"/sign-in">): Promise<Metadata> {
  const { callbackUrl } = await searchParams;
  const preview = signInPreviewFor(typeof callbackUrl === "string" ? callbackUrl : null);
  if (preview === "sign-in") {
    return shareMetadata({
      title: "Log in",
      description: "Log in to your workspace on Bananasplit.",
      card: SIGN_IN_CARD,
    });
  }
  if (preview === "join") {
    return {
      ...shareMetadata({
        title: "Join your club",
        description: "Enter the invite code whoever invited you sent, and join their workspace.",
        card: FALLBACK_CARDS.join,
        noIndex: true,
      }),
      title: "Log in · Bananasplit",
    };
  }
  // Everything else inherits the root layout's title, line and main card
  // (any openGraph here would drop the card); just keep it out of search.
  return { robots: { index: false, follow: false } };
}

/**
 * Auth.js sends its errors here (pages.error). The remaining ways a Google
 * sign-in can be refused after 0A Fix 4(d), explained in plain words.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "That Google account is linked to a different Bananasplit account than the one you're signed in with. Sign out, then sign in with your email and password, or with the Google account you used before.",
  AccessDenied:
    "Google didn't confirm that your email address is verified, so we couldn't sign you in with it. Verify the address with Google, or sign in with your email and password.",
  Verification: "That sign-in link is no longer valid.",
  SessionEnded: "You were signed out because that account no longer exists here. Sign in again.",
};

/** Log in: the auth card with "Welcome back." (design: App screens, 01). */
export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const session = await auth();
  const { error, callbackUrl: rawCallbackUrl, notice } = await searchParams;
  const errorCode = typeof error === "string" ? error : undefined;
  // Where to go after signing in: a same-origin relative path only.
  const callbackUrl = safeCallbackUrl(rawCallbackUrl);
  // Signed in already: say as whom, and offer a way out of that account
  // (unless Auth.js sent them back with an error to explain, e.g.
  // OAuthAccountNotLinked).
  if (session?.user?.email && !errorCode) {
    return (
      <AlreadySignedIn
        email={session.user.email}
        name={session.user.name ?? null}
        continueTo={callbackUrl ?? "/app"}
      />
    );
  }

  const errorMessage = errorCode
    ? (AUTH_ERROR_MESSAGES[errorCode] ?? "Something went wrong signing you in. Try again.")
    : null;
  // Only offered when the Google client is configured; otherwise the button
  // would only reach Auth.js's "server configuration" error.
  const googleEnabled = googleSignInEnabled();

  return (
    <AuthCard footer={<SignedInAs />}>
      <AuthTitle title="Welcome back." />
      {notice === "password-reset" && !errorMessage && (
        <FormMessage tone="info">Your password is changed. Log in with the new one.</FormMessage>
      )}
      {errorMessage && <FormMessage>{errorMessage}</FormMessage>}
      {googleEnabled && (
        <>
          <BrandGoogleButton redirectTo={callbackUrl} />
          <OrDivider />
        </>
      )}
      <PasswordSignInForm callbackUrl={callbackUrl} />
    </AuthCard>
  );
}
