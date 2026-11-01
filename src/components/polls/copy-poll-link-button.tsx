"use client";

import { Link2 } from "@/components/icons";

import { copyGuestPollLink, copyPollLink } from "./copy-link";

/**
 * A Find a time card's copy button, so sending the link doesn't mean
 * opening the poll first. An open poll that takes guests copies its public
 * page; otherwise the member link.
 */
export function CopyPollLinkButton({
  pollId,
  href,
  guests,
  title,
  className,
}: {
  pollId: string;
  href: string;
  guests: boolean;
  title: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={`Copy link: ${title}`}
      title="Copy link"
      onClick={() => (guests ? copyGuestPollLink(pollId) : copyPollLink(href))}
      className={
        "text-muted-foreground hover:text-foreground hover:bg-muted focus-glow grid size-8 place-items-center rounded-full outline-none active:scale-[0.94] " +
        (className ?? "")
      }
    >
      <Link2 className="size-4" aria-hidden="true" />
    </button>
  );
}
