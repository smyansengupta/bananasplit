"use client";

import Link from "next/link";
import { useActionState } from "react";

import { FormMessage, PrimaryButton } from "@/components/brand/fields";
import { NewPasswordField } from "@/components/brand/new-password-field";
import { pill } from "@/components/brand/pill";
import { cn } from "@/lib/utils";

import type { ResetPasswordState } from "./actions";
import { clearInvalid, highlightInvalid } from "@/lib/forms/highlight-invalid";

/** The new password, posted to the reset action already bound to the link's token. */
export function ResetPasswordForm({
  action,
}: {
  action: (state: ResetPasswordState, formData: FormData) => Promise<ResetPasswordState>;
}) {
  const [state, formAction, isPending] = useActionState(action, {});

  if (state.linkDead) {
    return (
      <>
        {state.error && <FormMessage>{state.error}</FormMessage>}
        <Link href="/forgot-password" className={cn(pill(), "w-full")}>
          Send a new link
        </Link>
      </>
    );
  }

  return (
    <form
      noValidate
      onSubmit={highlightInvalid}
      onInput={clearInvalid}
      action={formAction}
      className="flex flex-col gap-5"
    >
      <NewPasswordField label="New password" autoFocus />
      {state.error && <FormMessage>{state.error}</FormMessage>}
      <PrimaryButton type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Set new password"}
      </PrimaryButton>
      <p className="text-muted-foreground m-0 text-center text-[13px] leading-[1.5]">
        You&apos;ll be signed out everywhere, then log in with the new password.
      </p>
    </form>
  );
}
