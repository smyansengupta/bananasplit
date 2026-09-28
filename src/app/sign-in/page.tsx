import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { auth } from "@/lib/auth/config";

import { PasswordSignInForm } from "./password-sign-in-form";

/**
 * Auth.js sends its errors here (pages.error). The remaining ways a Google
 * sign-in can be refused after 0A Fix 4(d), explained in plain words.
 *
 * Google sign-in is off in the UI for now (this page and /invite/[token]
 * offer email and password only), but the provider is still configured in
 * src/lib/auth/config.ts: bringing it back means restoring the "Continue
 * with Google" form (a server action calling signIn("google", { redirectTo }))
 * and src/components/google-icon.tsx, removed with it. These messages stay
 * for that.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked:
    "That Google account is linked to a different Clubport account than the one you're signed in with. Sign out, then sign in with your email and password, or with the Google account you used before.",
  AccessDenied:
    "Google didn't confirm that your email address is verified, so we couldn't sign you in with it. Verify the address with Google, or sign in with your email and password.",
  Verification: "That sign-in link is no longer valid.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const session = await auth();
  const { error, callbackUrl: rawCallbackUrl } = await searchParams;
  const errorCode = typeof error === "string" ? error : undefined;
  // Where to go after signing in: a same-origin relative path only.
  const callbackUrl = safeCallbackUrl(rawCallbackUrl);
  // A signed-in user normally has nothing to do here, unless Auth.js sent
  // them back with an error to explain (e.g. OAuthAccountNotLinked).
  if (session && !errorCode) {
    redirect(callbackUrl ?? "/");
  }

  const errorMessage = errorCode
    ? (AUTH_ERROR_MESSAGES[errorCode] ?? "Something went wrong signing you in. Try again.")
    : null;

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Clubport</CardTitle>
          <CardDescription>Use your email and password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && (
            <p className="text-destructive text-sm" role="alert">
              {errorMessage}
            </p>
          )}
          <PasswordSignInForm callbackUrl={callbackUrl} />
        </CardContent>
      </Card>
    </div>
  );
}
