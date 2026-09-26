"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SharePollLink({ pollId }: { pollId: string }) {
  const [copied, setCopied] = useState(false);
  const [url] = useState(() =>
    typeof window !== "undefined" ? `${window.location.origin}/poll/${pollId}` : "",
  );

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="bg-muted/40 flex items-center gap-2 rounded-md border p-2">
      <span className="text-muted-foreground shrink-0 text-xs">Shareable link:</span>
      <Input value={url} readOnly className="h-7 font-mono text-xs" />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-7 shrink-0"
        onClick={handleCopy}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}
