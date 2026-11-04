"use client";

import { Copy } from "@/components/icons";
import { copyToClipboard } from "@/components/meetings/copy-to-clipboard";
import { Button } from "@/components/ui/button";

/**
 * "Copy link" on a Meetings card. The only client code on the card: the rest
 * is server-rendered, and a button cannot live inside the card's link.
 *
 * `title` is the meeting's, so the button is named for it ("Copy link for
 * Exec sync") while still reading "Copy link".
 */
export function CopyLinkButton({
  url,
  title,
  className,
}: {
  url: string;
  title: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={className}
      aria-label={`Copy link for ${title}`}
      onClick={() => void copyToClipboard(url, "Link copied")}
    >
      <Copy aria-hidden />
      Copy link
    </Button>
  );
}
