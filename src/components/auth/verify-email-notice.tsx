"use client";

import { MailCheck } from "lucide-react";
import { useActionState } from "react";

import { resendVerificationEmailAction, type ResendState } from "@/app/verify-email/actions";
import { Button } from "@/components/ui/button";

/**
 * The 'check your email' state for a signed-in user whose address is not
 * verified yet (0A Fix 4). Shown wherever an unverified account would
 * otherwise create or join an organization; onboarding, where sign-in lands
 * an account without an org, is the main one.
 */
export function VerifyEmailNotice({ email, action }: { email: string; action: string }) {
  const [state, formAction, isPending] = useActionState<ResendState, FormData>(
    resendVerificationEmailAction,
    {},
  );

  return (
    <div className="bg-muted/40 space-y-3 rounded-md border p-4" role="status">
      <div className="flex items-start gap-3">
        <MailCheck className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Check your email</p>
          <p className="text-muted-foreground text-sm">
            Your email address isn&apos;t verified yet. We sent a verification link to{" "}
            <span className="font-medium">{email}</span>. Verify your address to {action}.
          </p>
        </div>
      </div>
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {isPending ? "Sending…" : "Resend verification email"}
        </Button>
        <span aria-live="polite" className="text-xs">
          {state.sent && (
            <span className="text-muted-foreground">
              A new link is on its way. It may take a minute to arrive.
            </span>
          )}
          {state.verified && (
            <span className="text-muted-foreground">
              Your email is already verified. Refresh this page to continue.
            </span>
          )}
          {state.error && <span className="text-destructive">{state.error}</span>}
        </span>
      </form>
    </div>
  );
}
