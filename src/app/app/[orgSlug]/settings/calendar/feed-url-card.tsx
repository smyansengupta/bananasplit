"use client";

import { Check, Copy, Link2, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { regenerateIcsToken } from "./actions";

/**
 * Regenerate-to-view (0A Fix 7). The feed token is stored only as a hash,
 * so an existing link can never be shown again:
 *   - no link yet: "Create feed link";
 *   - a link exists: "Feed active since <date>" and "Regenerate link";
 *   - right after creating or regenerating: the full URL, once, with a copy
 *     control and a warning that any previous URL has stopped working.
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
  const [replacedExisting, setReplacedExisting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCopy() {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleGenerate() {
    setError(null);
    const hadLink = Boolean(since);
    startTransition(async () => {
      try {
        const token = await regenerateIcsToken();
        setUrl(`${feedBaseUrl}${token}`);
        setSince(new Date().toISOString());
        setReplacedExisting(hadLink);
        setCopied(false);
      } catch {
        setError("Couldn't create a feed link. Try again.");
      }
    });
  }

  if (!url) {
    return (
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">
          {since
            ? `Feed active since ${new Date(since).toLocaleDateString()}. For security the link is shown only once, when it's created.`
            : "You don't have a feed link yet."}
        </p>
        <Button type="button" variant="outline" onClick={handleGenerate} disabled={isPending}>
          {since ? <RotateCcw className="size-4" /> : <Link2 className="size-4" />}
          {since ? "Regenerate link" : "Create feed link"}
        </Button>
        {since ? (
          <p className="text-muted-foreground text-xs">
            Regenerating shows a new link once. Your current link stops working immediately, so
            update every calendar app that subscribes to it.
          </p>
        ) : null}
        {error && <p className="text-destructive text-sm">{error}</p>}
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
      </div>
      <p className="text-muted-foreground text-xs">
        Copy this link now: it won&apos;t be shown again.
        {replacedExisting
          ? " Your previous feed link has stopped working; replace it wherever you subscribed."
          : ""}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleGenerate}
        disabled={isPending}
      >
        <RotateCcw className="size-4" />
        Regenerate link
      </Button>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
