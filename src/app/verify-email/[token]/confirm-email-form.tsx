"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { confirmEmailAction, type ConfirmEmailState } from "../actions";

export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState<ConfirmEmailState, FormData>(
    (prev) => confirmEmailAction(token, prev),
    {},
  );

  if (state.verified) {
    return (
      <div className="space-y-3" role="status">
        <p className="text-sm">Your email is verified.</p>
        <Button asChild className="w-full">
          <Link href="/sign-in">Sign in to continue</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="text-destructive text-sm">{state.error}</p>}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Verifying…" : "Confirm my email"}
      </Button>
      {state.error && (
        <p className="text-muted-foreground text-center text-sm">
          <Link href="/sign-in" className="underline underline-offset-4">
            Go to sign in
          </Link>
        </p>
      )}
    </form>
  );
}
