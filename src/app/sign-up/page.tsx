import { AlreadySignedIn } from "@/components/auth/already-signed-in";
import { BrandGoogleButton } from "@/components/auth/google-sign-in-button";
import { AuthCard } from "@/components/brand/auth-card";
import { OrDivider } from "@/components/brand/fields";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { auth } from "@/lib/auth/config";
import { googleSignInEnabled } from "@/lib/auth/google-sign-in";
import { onboardingHref } from "@/lib/onboarding/steps";

import { SignUpForm } from "./sign-up-form";

export const metadata = { title: "Create your account · Bananasplit" };

/**
 * Sign up: a personal account, one for everyone, its Personal space on a
 * 14-day trial of Personal Plus. Next comes "What are you here for?"
 * (/onboarding), unless they came from somewhere specific (?callbackUrl=,
 * e.g. an invite link or "Get started"), which they go straight back to.
 * Already signed in: say so, with Continue and Sign out.
 */
export default async function SignUpPage({ searchParams }: PageProps<"/sign-up">) {
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  const session = await auth();
  if (session?.user?.email) {
    return (
      <AlreadySignedIn
        email={session.user.email}
        name={session.user.name ?? null}
        continueTo={callbackUrl ?? "/app"}
      />
    );
  }

  // Only offered when the Google client is configured (as on /sign-in).
  const googleEnabled = googleSignInEnabled();

  return (
    <AuthCard tall formClassName="gap-[18px] lg:py-9">
      <SignUpForm
        callbackUrl={callbackUrl}
        google={
          googleEnabled ? (
            <>
              <BrandGoogleButton
                label="Sign up with Google"
                redirectTo={onboardingHref(callbackUrl)}
              />
              <OrDivider />
            </>
          ) : null
        }
      />
    </AuthCard>
  );
}
