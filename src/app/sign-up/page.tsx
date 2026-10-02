import { redirect } from "next/navigation";

import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthOrDivider, GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth/config";
import { googleSignInEnabled } from "@/lib/auth/google-sign-in";

import { SignUpForm } from "./sign-up-form";

export default async function SignUpPage() {
  const session = await auth();
  if (session) {
    redirect("/");
  }

  // Only offered when the Google client is configured (as on /sign-in).
  const googleEnabled = googleSignInEnabled();

  return (
    <AuthFrame>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">Create your account</CardTitle>
          <CardDescription>
            {googleEnabled
              ? "Use your Google account, or sign up with an email and password."
              : "Sign up with an email and password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignUpForm
            google={
              googleEnabled ? (
                <>
                  <GoogleSignInButton />
                  <AuthOrDivider />
                </>
              ) : null
            }
          />
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
