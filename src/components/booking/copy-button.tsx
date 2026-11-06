"use client";

import { useEffect, useRef, useState } from "react";

import { Check, Copy } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

/** How long the button says Copied. */
export const COPIED_MS = 2000;

/**
 * Copy link on a meeting link: the button says Copied for two seconds, so
 * nothing else appears on the page. A browser that refuses is told, since the
 * button can't say that in a word. It keeps its width so the row doesn't move.
 */
export function CopyButton({ url, title, className }: { url: string; title: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toast({ title: "Couldn't copy. Your browser blocked the clipboard.", tone: "error" });
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("relative z-10 min-w-[6.75rem]", className)}
      aria-label={copied ? "Copied" : `Copy link for ${title}`}
      onClick={() => void copy()}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
