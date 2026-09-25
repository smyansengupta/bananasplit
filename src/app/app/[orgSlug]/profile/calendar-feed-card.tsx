"use client";

import { Check, Copy, Link2, Loader2, RotateCcw, TriangleAlert, Unlink } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { createCalendarFeedLink, turnOffCalendarFeed } from "./actions";

type Confirm = null | "regenerate" | "off";

function formatSince(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * The personal calendar feed, regenerate-to-view. Only a hash of the token
 * is stored, so the link is shown once, right after it is created, and can
 * never be shown again:
 * - no link: "No feed link yet" and "Create link";
 * - a link: "Feed active since {date}", "Generate new link" (the old link
 *   stops working) and "Turn off feed" (clears it);
 * - just created: the full URL with a copy button and a warning.
 */
export function CalendarFeedCard({ activeSince }: { activeSince: string | null }) {
  const [since, setSince] = useState(activeSince);
  const [url, setUrl] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    const hadLink = Boolean(since);
    setConfirm(null);
    setMessage(null);
    startTransition(async () => {
      const result = await createCalendarFeedLink();
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error });
        return;
      }
      setUrl(result.url);
      setSince(result.createdAt);
      setReplaced(hadLink);
      setCopied(false);
    });
  }

  function turnOff() {
    setConfirm(null);
    setMessage(null);
    startTransition(async () => {
      const result = await turnOffCalendarFeed();
      if (!result.ok) {
        setMessage({ tone: "error", text: result.error ?? "Couldn't turn the feed off." });
        return;
      }
      setUrl(null);
      setSince(null);
      setMessage({ tone: "info", text: "Feed turned off. The old link no longer works." });
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ tone: "error", text: "Couldn't copy. Select the link and copy it yourself." });
    }
  }

  return (
    <div className="space-y-4">
      {url ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-xs"
              aria-label="Your calendar feed link"
            />
            <Button type="button" variant="outline" onClick={copy}>
              {copied ? (
                <Check className="size-4" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="border-warning/40 bg-warning/10 flex gap-2 rounded-md border p-3 text-sm">
            <TriangleAlert className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              Copy this link now. For your security it won&apos;t be shown again: to see a link
              later you&apos;ll need to generate a new one.
              {replaced &&
                " Your previous link has stopped working, so update every calendar app that used it."}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm">
          {since ? (
            <>
              Feed active since <span className="font-medium">{formatSince(since)}</span>. The link
              was shown once, when it was created.
            </>
          ) : (
            <span className="text-muted-foreground">No feed link yet.</span>
          )}
        </p>
      )}

      {confirm === "regenerate" && (
        <div
          className="bg-muted/50 space-y-3 rounded-md border p-3 text-sm"
          role="group"
          aria-label="Confirm new link"
        >
          <p>
            Generate a new link? Your current link stops working right away, and calendar apps
            subscribed to it stop updating until you give them the new one.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={generate} disabled={pending}>
              Generate new link
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {confirm === "off" && (
        <div
          className="bg-muted/50 space-y-3 rounded-md border p-3 text-sm"
          role="group"
          aria-label="Confirm turning off"
        >
          <p>Turn off your feed? The link stops working and subscribed calendars stop updating.</p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={turnOff}
              disabled={pending}
            >
              Turn off feed
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {confirm === null && (
        <div className="flex flex-wrap gap-2">
          {since ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirm("regenerate")}
                disabled={pending}
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="size-4" aria-hidden="true" />
                )}
                Generate new link
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirm("off")}
                disabled={pending}
              >
                <Unlink className="size-4" aria-hidden="true" />
                Turn off feed
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={generate} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Link2 className="size-4" aria-hidden="true" />
              )}
              Create link
            </Button>
          )}
        </div>
      )}

      <p aria-live="polite" className="text-sm">
        {message && (
          <span className={message.tone === "error" ? "text-destructive" : "text-muted-foreground"}>
            {message.text}
          </span>
        )}
      </p>
    </div>
  );
}
