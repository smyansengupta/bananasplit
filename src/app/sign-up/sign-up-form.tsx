"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { AuthTitle } from "@/components/brand/auth-card";
import { BrandField, BrandInput, FormMessage, PrimaryButton } from "@/components/brand/fields";
import { NewPasswordField } from "@/components/brand/new-password-field";
import { pill } from "@/components/brand/pill";
import { PRIVACY_HREF, TERMS_HREF } from "@/lib/brand/links";
import { cn } from "@/lib/utils";

import { signUpAction } from "./actions";
import { clearInvalid, highlightInvalid } from "@/lib/forms/highlight-invalid";

/**
 * One sign-up for everyone, for a personal account: name, email, a
 * password typed twice. "What are you here for?" comes next (/onboarding).
 * `google`: the "Sign up with Google" button and divider,
 * above the fields (not once it's sent). `callbackUrl`: where to go once
 * signed up, e.g. back to the invite link someone started from.
 */
export function SignUpForm({
  google,
  callbackUrl,
}: {
  google?: React.ReactNode;
  callbackUrl?: string | null;
}) {
  const signInHref = callbackUrl
    ? `/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`
    : "/sign-in";
  const [state, formAction, isPending] = useActionState(signUpAction, {});
  // Controlled, so React's reset after the action doesn't wipe what was typed.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  if (state.checkEmail) {
    return (
      <>
        <AuthTitle
          title="Check your email."
          description={
            <>
              We sent a verification link to{" "}
              <span className="font-semibold">{state.checkEmail}</span>. Open it to verify your
              address, then log in. You need a verified email to join or start an organization.
            </>
          }
        />
        {state.error && <FormMessage>{state.error}</FormMessage>}
        <Link href={signInHref} className={cn(pill(), "w-full")}>
          Go to log in
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthTitle title="Create your account." />
      {google}
      <form
        noValidate
        onSubmit={highlightInvalid}
        onInput={clearInvalid}
        action={formAction}
        className="flex flex-col gap-[18px]"
      >
        {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
        <BrandField id="name" label="Full name">
          <BrandInput
            id="name"
            name="name"
            required
            autoComplete="name"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </BrandField>
        <BrandField id="email" label="Email">
          <BrandInput
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </BrandField>
        <NewPasswordField />
        {state.error && <FormMessage>{state.error}</FormMessage>}
        <PrimaryButton type="submit" disabled={isPending}>
          {isPending ? "Creating account…" : "Create account"}
        </PrimaryButton>
        <p className="text-muted-foreground m-0 text-center text-[13px] leading-[1.5]">
          You agree to the{" "}
          <Link href={TERMS_HREF} className="text-foreground underline underline-offset-2">
            Terms
          </Link>{" "}
          and{" "}
          <Link href={PRIVACY_HREF} className="text-foreground underline underline-offset-2">
            Privacy Policy
          </Link>
          . Have an account?{" "}
          <Link
            href={signInHref}
            className="text-foreground font-semibold underline decoration-current/30 underline-offset-2 hover:decoration-current"
          >
            Log in
          </Link>
        </p>
      </form>
    </>
  );
}
