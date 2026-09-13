import { redirect } from "next/navigation";

import { GoogleIcon } from "@/components/google-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { auth, signIn } from "@/lib/auth/config";

import { PasswordSignInForm } from "./password-sign-in-form";

export default async function SignInPage() {
  const session = await auth();
  if (session) {
    redirect("/");
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to CBC Portal</CardTitle>
          <CardDescription>Use your Google account or your email and password.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            action={async () => {
              "use server";
              await signIn("google");
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

          <PasswordSignInForm />
        </CardContent>
      </Card>
    </div>
  );
}
