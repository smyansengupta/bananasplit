"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { BrandField, BrandInput, FormMessage, PrimaryButton } from "@/components/brand/fields";

import { passwordSignInAction } from "./actions";
import { clearInvalid, highlightInvalid } from "@/lib/forms/highlight-invalid";

export function PasswordSignInForm({ callbackUrl }: { callbackUrl?: string | null }) {
  const [state, formAction, isPending] = useActionState(passwordSignInAction, {});
  // Controlled, so React's reset after the action doesn't wipe what was typed.
  const [email, setEmail] = useState("");

  return (
    <form
      noValidate
      onSubmit={highlightInvalid}
      onInput={clearInvalid}
      action={formAction}
      className="flex flex-col gap-5"
    >
      {callbackUrl && <input type="hidden" name="callbackUrl" value={callbackUrl} />}
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
      <BrandField
        id="password"
        label="Password"
        aside={
          <Link
            href="/forgot-password"
            className="text-muted-foreground hover:text-foreground text-[13px] font-medium transition-colors"
          >
            Forgot?
          </Link>
        }
      >
        <BrandInput
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
        />
      </BrandField>
      {state.error && <FormMessage>{state.error}</FormMessage>}
      <PrimaryButton type="submit" disabled={isPending}>
        {isPending ? "Logging in…" : "Log in"}
      </PrimaryButton>
      <p className="text-muted-foreground m-0 text-center text-[14px]">
        New to Bananasplit?{" "}
        <Link
          href={
            callbackUrl ? `/sign-up?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/sign-up"
          }
          className="text-foreground font-semibold underline decoration-current/30 underline-offset-2 hover:decoration-current"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
