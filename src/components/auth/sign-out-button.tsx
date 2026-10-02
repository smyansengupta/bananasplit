"use client";

import { Loader2, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Signs out and returns to the landing page, like the shell's user menu.
 * For pages outside an org (onboarding), where there is no user menu.
 */
export function SignOutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("text-muted-foreground", className)}
      disabled={pending}
      onClick={() => {
        setPending(true);
        signOut({ redirectTo: "/" }).catch(() => setPending(false));
      }}
    >
      {pending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <LogOut aria-hidden="true" />
      )}
      Sign out
    </Button>
  );
}
