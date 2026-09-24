import { ExternalLink, Globe, Link as LinkIcon } from "lucide-react";

import { linkDisplayText, type ProfileLink } from "@/lib/profile/links";
import { cn } from "@/lib/utils";

/**
 * A person's profile links. The URLs were validated on save and again on
 * read (parseStoredLinks: http/https only), and open in a new tab with
 * rel="noopener noreferrer nofollow" and no referrer.
 */
export function ProfileLinks({ links, className }: { links: ProfileLink[]; className?: string }) {
  if (links.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {links.map((link, index) => {
        const Icon = link.kind === "website" ? Globe : link.kind === "other" ? LinkIcon : ExternalLink;
        return (
          <li key={`${link.url}-${index}`}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              referrerPolicy="no-referrer"
              className="hover:bg-muted focus-visible:ring-ring inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              title={link.url}
            >
              <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{linkDisplayText(link)}</span>
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** "Computer Science · Class of 2028", or whichever part is set. */
export function majorAndYear(major: string | null, gradYear: number | null): string | null {
  const parts = [major, gradYear ? `Class of ${gradYear}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
