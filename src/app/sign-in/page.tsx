import { redirect } from "next/navigation";

import { GoogleIcon } from "@/components/google-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { safeCallbackUrl } from "@/lib/auth/callback-url";
import { auth, signIn } from "@/lib/auth/config";
import { googleSignInEnabled } from "@/lib/auth/google-sign-in";

import { PasswordSignInForm } from "./password-sign-in-form";

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
  // Only offered when the Google client is configured; otherwise the button
  // would only reach Auth.js's "server configuration" error.
  const googleEnabled = googleSignInEnabled();

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Bananasplit</CardTitle>
          <CardDescription>
            {googleEnabled
              ? "Use your Google account or your email and password."
              : "Use your email and password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && (
            <p className="text-destructive text-sm" role="alert">
              {errorMessage}
            </p>
          )}
          {googleEnabled && (
            <>
              <form
                action={async () => {
                  "use server";
                  await signIn("google", callbackUrl ? { redirectTo: callbackUrl } : undefined);
                }}
              >
                <Button type="submit" variant="outline" className="w-full">
                  <GoogleIcon className="size-4" />
                  Continue with Google
                </Button>
              </form>

              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-muted-foreground text-xs">or</span>
                <Separator className="flex-1" />
              </div>
            </>
          )}

          <PasswordSignInForm callbackUrl={callbackUrl} />
        </CardContent>
      </Card>
    </div>
  );
}
