"use client";

import { Check, Copy, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { regenerateIcsToken } from "./actions";

export function FeedUrlCard({ initialUrl }: { initialUrl: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCopy() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleRegenerate() {
    startTransition(async () => {
      const token = await regenerateIcsToken();
      const next = new URL(url);
      next.pathname = next.pathname.replace(/\/feed\/[^/]+$/, `/feed/${token}`);
      setUrl(next.toString());
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={url} readOnly className="font-mono text-xs" />
        <Button type="button" variant="outline" size="icon" onClick={handleCopy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleRegenerate}
          disabled={isPending}
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Regenerating invalidates the old link — update it anywhere you&apos;ve subscribed.
      </p>
    </div>
  );
}
