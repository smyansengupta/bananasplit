import { GoogleIcon } from "@/components/google-icon";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { signIn } from "@/lib/auth/config";

/**
 * "Continue with Google" (/sign-in, /sign-up, /invite/[token]). With Google,
 * signing in and creating an account are the same step: Auth.js creates the
 * user on first use, already verified (see google-linking.ts). Render it
 * only when googleSignInEnabled(), or it leads to Auth.js's "server
 * configuration" error.
 */
export function GoogleSignInButton({ redirectTo }: { redirectTo?: string | null }) {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("google", redirectTo ? { redirectTo } : undefined);
      }}
    >
      <Button type="submit" variant="outline" className="w-full">
        <GoogleIcon className="size-4" />
        Continue with Google
      </Button>
    </form>
  );
}

/** The "or" between the Google button and the email form. */
export function AuthOrDivider() {
  return (
    <div className="flex items-center gap-3">
      <Separator className="flex-1" />
      <span className="text-muted-foreground text-xs">or</span>
      <Separator className="flex-1" />
    </div>
  );
}
