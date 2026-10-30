"use client";

import { Check, Copy, Mail } from "@/components/icons";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

/**
 * Copy a member's email. Rendered only when the viewer may see it: the
 * server leaves the email out of the data otherwise. `inline` is the email
 * itself as the button (a profile's Contact row), so the address and its
 * copy are one control.
 */
export function CopyEmailButton({
  email,
  name,
  inline = false,
}: {
  email: string;
  name: string;
  inline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      toast({ title: "Email copied", tone: "success", duration: 3000 });
    } catch {
      toast({ title: "Couldn't copy. Select it and copy instead.", tone: "error" });
    }
  }
  if (inline) {
    return (
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${name}'s email, ${email}`}
        className="focus-glow group inline-flex max-w-full items-center gap-1.5 rounded-full text-left break-all outline-none hover:underline"
      >
        {email}
        {copied ? (
          <Check className="text-success size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Copy className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
        )}
      </button>
    );
  }
  return (
    <Button type="button" size="sm" onClick={() => void copy()}>
      {copied ? <Check aria-hidden="true" /> : <Mail aria-hidden="true" />}
      {copied ? "Copied" : "Copy email"}
    </Button>
  );
}
