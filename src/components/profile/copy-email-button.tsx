"use client";

import { Check, Mail } from "@/components/icons";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

/**
 * Copy a member's email. Rendered only when the viewer may see it: the
 * server leaves the email out of the data otherwise.
 */
export function CopyEmailButton({ email, name }: { email: string; name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(email);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
          toast({ title: `Copied: ${name}'s email`, tone: "success", duration: 3000 });
        } catch {
          toast({ title: "Couldn't copy the email. Your browser blocked the clipboard.", tone: "error" });
        }
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Mail aria-hidden="true" />}
      {copied ? "Copied" : "Copy email"}
    </Button>
  );
}
