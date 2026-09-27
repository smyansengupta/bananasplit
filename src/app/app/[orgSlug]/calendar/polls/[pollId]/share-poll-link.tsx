"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The public link, for people outside the org: they answer as guests with
 * no account. The URL comes from the server (appUrl), so the field is filled
 * in the first paint rather than after hydration.
 */
export function SharePollLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  }

  return (
    <section className="bg-muted/40 space-y-2 rounded-lg border p-3" aria-labelledby="poll-share">
      <h2 id="poll-share" className="text-sm font-medium">
        Share this poll
      </h2>
      <p className="text-muted-foreground text-xs">
        Anyone with the link can answer, no account needed. Members answer as themselves.
      </p>
      <Input
        value={url}
        readOnly
        aria-label="Poll link"
        onFocus={(e) => e.currentTarget.select()}
        className="h-8 text-xs"
      />
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          {copied ? (
            <Check aria-hidden className="size-3.5" />
          ) : (
            <Copy aria-hidden className="size-3.5" />
          )}
          {copied ? "Copied" : "Copy link"}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
        >
          Open guest view
          <ExternalLink aria-hidden className="size-3" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      {failed && (
        <p className="text-destructive text-xs" role="alert">
          Couldn&apos;t copy. Select the link and copy it yourself.
        </p>
      )}
    </section>
  );
}
