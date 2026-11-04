"use client";

import { Check, Link2, Share2 } from "@/components/icons";
import { useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

const noSubscribe = () => () => {};

/**
 * The circle button beside the RSVP page's actions: the share sheet where
 * the browser has one, else copy the page's link. Says "Copied" for two
 * seconds in its tooltip and to screen readers.
 */
export function SharePage({
  url,
  title,
  className,
}: {
  url: string;
  title: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const canShare = useSyncExternalStore(
    noSubscribe,
    () => typeof navigator.share === "function",
    () => false,
  );

  async function onClick() {
    if (canShare) {
      try {
        await navigator.share({ title, url });
      } catch {
        // Closed the share sheet: nothing to do.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", url);
    }
  }

  const label = canShare ? "Share this event" : copied ? "Link copied" : "Copy the link";
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      aria-label={label}
      title={label}
      className={cn(
        "border-input text-foreground hover:bg-muted grid size-10 flex-none cursor-pointer place-items-center rounded-full border transition-[background-color,transform] duration-150 active:scale-[0.94] pointer-coarse:size-11",
        className,
      )}
    >
      {copied ? (
        <Check className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
      ) : canShare ? (
        <Share2 className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Link2 className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? "Link copied" : ""}
      </span>
    </button>
  );
}
