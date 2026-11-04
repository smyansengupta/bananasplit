"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { AuthTitle } from "@/components/brand/auth-card";
import { BrandField, BrandInput, FormMessage, PrimaryButton } from "@/components/brand/fields";
import { pill } from "@/components/brand/pill";
import { cn } from "@/lib/utils";

import { requestPasswordResetAction } from "./actions";
import { clearInvalid, highlightInvalid } from "@/lib/forms/highlight-invalid";

/** Ask for a reset link; then "check your email", the same whether or not the address has an account. */
export function ForgotPasswordForm({
  expiresMinutes,
  googleEnabled,
}: {
  expiresMinutes: number;
  googleEnabled: boolean;
}) {
  const [state, formAction, isPending] = useActionState(requestPasswordResetAction, {});
  // Controlled, so React's reset after the action doesn't wipe what was typed.
  const [email, setEmail] = useState("");

  if (state.sentTo) {
    return (
      <>
        <AuthTitle
          title="Check your email."
          description={
            <>
              If an account uses <span className="font-semibold">{state.sentTo}</span>, a link to
              set a new password is on its way. It works once and expires in {expiresMinutes}{" "}
              minutes.
            </>
          }
        />
        <Link href="/sign-in" className={cn(pill(), "w-full")}>
          Back to log in
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthTitle title="Forgot your password?" description="We'll email you a link." />
      <form
        noValidate
        onSubmit={highlightInvalid}
        onInput={clearInvalid}
        action={formAction}
        className="flex flex-col gap-5"
      >
        <BrandField id="email" label="Email">
          <BrandInput
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </BrandField>
        {state.error && <FormMessage>{state.error}</FormMessage>}
        <PrimaryButton type="submit" disabled={isPending}>
          {isPending ? "Sending…" : "Send reset link"}
        </PrimaryButton>
        <p className="text-muted-foreground m-0 text-center text-[14px] leading-[1.5]">
          {googleEnabled && "Signed up with Google? Just log in with Google. "}
          Remembered it?{" "}
          <Link
            href="/sign-in"
            className="text-foreground font-semibold underline decoration-current/30 underline-offset-2 hover:decoration-current"
          >
            Log in
          </Link>
        </p>
      </form>
    </>
  );
}
