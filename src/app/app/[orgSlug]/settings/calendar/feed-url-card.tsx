"use client";

import { Check, Copy, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { regenerateIcsToken } from "./actions";

/**
 * The feed token is stored only as a hash, so the full URL is shown once,
 * right after it is created. Afterwards the card shows when the current
 * link was created and offers a new one.
 */
export function FeedUrlCard({
  feedBaseUrl,
  activeSince,
}: {
  feedBaseUrl: string;
  activeSince: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [since, setSince] = useState<string | null>(activeSince);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleCopy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleGenerate() {
    startTransition(async () => {
      const token = await regenerateIcsToken();
      setUrl(`${feedBaseUrl}${token}`);
      setSince(new Date().toISOString());
    });
  }

  if (!url) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">
          {since
            ? `Your feed link has been active since ${new Date(since).toLocaleDateString()}. For security it is shown only once; create a new link if you need it again.`
            : "You don't have a feed link yet."}
        </p>
        <Button type="button" variant="outline" onClick={handleGenerate} disabled={isPending}>
          <RotateCcw className="size-4" />
          {since ? "Create a new link" : "Create feed link"}
        </Button>
        {since ? (
          <p className="text-muted-foreground text-xs">
            A new link replaces the old one; update it anywhere you&apos;ve subscribed.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input value={url} readOnly className="font-mono text-xs" aria-label="Calendar feed URL" />
        <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label="Copy">
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={handleGenerate}
          disabled={isPending}
          aria-label="Create a new link"
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Copy this link now: it is shown only once. Creating a new link invalidates this one.
      </p>
    </div>
  );
}
