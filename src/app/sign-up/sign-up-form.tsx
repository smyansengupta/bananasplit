"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { signUpAction } from "./actions";

/** `google`: the "Continue with Google" button, shown above the form (not once it's sent). */
export function SignUpForm({ google }: { google?: React.ReactNode }) {
  const [state, formAction, isPending] = useActionState(signUpAction, {});
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  if (state.checkEmail) {
    return (
      <div className="space-y-3" role="status">
        <p className="text-sm font-medium">Check your email</p>
        <p className="text-muted-foreground text-sm">
          We sent a verification link to <span className="font-medium">{state.checkEmail}</span>.
          Open it to verify your address, then sign in. You need a verified email to create or
          join an organization.
        </p>
        {state.error && (
          <p className="text-destructive text-sm" role="alert">
            {state.error}
          </p>
        )}
        <Button asChild variant="outline" className="w-full">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {google}
      <form action={formAction} className="space-y-3">
        <div className="grid gap-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-password">Confirm password</Label>
          <Input
            id="confirm-password"
            type="password"
            required
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {mismatch && <p className="text-destructive text-sm">Passwords don&apos;t match.</p>}
        </div>
        {state.error && <p className="text-destructive text-sm">{state.error}</p>}
        <Button type="submit" className="w-full" disabled={isPending || mismatch}>
          {isPending ? "Creating account…" : "Create account"}
        </Button>
        <p className="text-muted-foreground text-center text-sm">
          Already have an account?{" "}
          <Link href="/sign-in" className="underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
