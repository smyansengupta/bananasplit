"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";

/**
 * Signs out from anywhere a plain button or link fits: the "Signed in as"
 * line, the already-signed-in screen, the RSVP and home page bars. Lands on
 * log in, ready for another account (or `redirectTo`, e.g. log in coming
 * back to an invite).
 */
export function SignOutLink({
  className,
  children = "Sign out",
  redirectTo = "/sign-in",
}: {
  className?: string;
  children?: React.ReactNode;
  redirectTo?: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className={
        className ??
        "text-foreground cursor-pointer font-semibold underline decoration-current/30 underline-offset-2 hover:decoration-current"
      }
      disabled={pending}
      onClick={() => {
        setPending(true);
        signOut({ redirectTo }).catch(() => setPending(false));
      }}
    >
      {pending ? "Signing out…" : children}
    </button>
  );
}
