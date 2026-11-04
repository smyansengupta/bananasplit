"use client";

import { MailCheck } from "@/components/icons";
import { useActionState, useEffect } from "react";

import { resendVerificationEmailAction, type ResendState } from "@/app/verify-email/actions";
import { Button } from "@/components/ui/button";
import { AFTER_VERIFY_COOKIE, AFTER_VERIFY_MAX_AGE } from "@/lib/auth/after-verify";

/**
 * The 'check your email' state for a signed-in user whose address is not
 * verified yet (0A Fix 4). Shown wherever an unverified account would
 * otherwise create or join an organization; onboarding, where sign-in lands
 * an account without an org, is the main one.
 *
 * It remembers this page (AFTER_VERIFY_COOKIE), so the emailed link brings
 * the person straight back here, code or invite and all, instead of to the
 * app's front door. Continue checks again in this tab.
 */
export function VerifyEmailNotice({ email }: { email: string; action?: string }) {
  const [state, formAction, isPending] = useActionState<ResendState, FormData>(
    resendVerificationEmailAction,
    {},
  );

  useEffect(() => {
    const here = `${window.location.pathname}${window.location.search}`;
    document.cookie = `${AFTER_VERIFY_COOKIE}=${encodeURIComponent(here)}; path=/; max-age=${AFTER_VERIFY_MAX_AGE}; samesite=lax`;
  }, []);

  return (
    <div className="bg-muted rounded-tile space-y-3.5 p-4" role="status">
      <div className="flex items-start gap-3">
        <span className="bg-card grid size-9 shrink-0 place-items-center rounded-full">
          <MailCheck className="size-[18px]" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="heading text-[15px]">Check your email</p>
          <p className="text-muted-foreground text-sm leading-[1.5]">
            Open the link we sent to <span className="font-medium">{email}</span>.
          </p>
        </div>
      </div>
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={() => window.location.reload()}>
          I&apos;ve confirmed it
        </Button>
        <Button type="submit" variant="outline" size="sm" disabled={isPending}>
          {isPending ? "Sending…" : "Send it again"}
        </Button>
        <span aria-live="polite" className="text-xs">
          {state.sent && <span className="text-muted-foreground">Sent. It may take a minute.</span>}
          {state.verified && (
            <span className="text-muted-foreground">
              Already confirmed. Press I&apos;ve confirmed it.
            </span>
          )}
          {state.error && <span className="text-destructive">{state.error}</span>}
        </span>
      </form>
    </div>
  );
}
