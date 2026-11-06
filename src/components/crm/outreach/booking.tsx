"use client";

import { Copy, ExternalLink } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";

/**
 * A link with Copy and Open, as the CRM shows its public links (your
 * meeting link, your BCC address). Meeting links themselves are managed in
 * Meetings > Meeting links now (src/components/booking; docs/features/booking.md).
 */
export function CopyLink({ url, label }: { url: string; label?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <code className="bg-muted min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-xs">{url}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={label ?? "Copy the link"}
        title="Copy"
        onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => undefined);
          toast({ title: "Copied" });
        }}
      >
        <Copy className="size-4" aria-hidden="true" />
      </Button>
      <Button asChild variant="ghost" size="icon-sm" title="Open">
        <a href={url} target="_blank" rel="noreferrer" aria-label="Open">
          <ExternalLink className="size-4" aria-hidden="true" />
        </a>
      </Button>
    </div>
  );
}
