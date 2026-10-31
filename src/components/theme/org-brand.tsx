import Link from "next/link";

import { orgInitials, orgLogoSource } from "@/lib/theme/logo";
import type { LogoDisplayValue } from "@/lib/theme/types";
import { cn } from "@/lib/utils";

/**
 * The org's logo and name as Settings > Theme > Logo display says:
 * - LOGO_AND_NAME: the logo (or a monogram in the primary colour when the
 *   org has no logo yet) beside the name;
 * - LOGO_ONLY: the logo alone, larger (for wordmarks); falls back to
 *   LOGO_AND_NAME without a logo;
 * - NAME_ONLY: the name alone, or nothing where the name already shows
 *   (`hideNameOnly`).
 *
 * Server- and client-safe (no hooks). Logos are public, re-encoded WebP
 * variants (src/server/images); plain <img> like UserAvatar, no next/image.
 */
export function OrgBrand({
  name,
  logo,
  display,
  href,
  hideNameOnly = false,
  compact = false,
  className,
}: {
  /** The sidebar's size (the workspace plan): a 22px mark and the name in the body font. */
  compact?: boolean;
  name: string;
  logo: unknown;
  display: LogoDisplayValue;
  /** Makes the brand a link (e.g. to the org's overview). */
  href?: string;
  hideNameOnly?: boolean;
  className?: string;
}) {
  if (display === "NAME_ONLY" && hideNameOnly) return null;

  const wide = display === "LOGO_ONLY" ? orgLogoSource(logo, 40) : null;
  const markClass = compact
    ? "size-[22px] rounded-[6px] text-[10px]"
    : "size-8 rounded-md text-[0.8rem]";
  // In the sidebar the name keeps to one line, ending in "…" when long.
  const nameClass = compact ? "truncate text-[13.5px] font-semibold" : "heading text-[0.95rem]";
  const mark = orgLogoSource(logo, 32);

  let content: React.ReactNode;
  if (display === "NAME_ONLY") {
    content = <span className={cn("min-w-0 leading-tight break-words", nameClass)}>{name}</span>;
  } else if (wide) {
    content = (
      // eslint-disable-next-line @next/next/no-img-element -- pre-sized public WebP variants
      <img
        src={wide.src}
        srcSet={wide.srcSet}
        alt={name}
        className="h-10 w-auto max-w-full object-contain object-left"
        decoding="async"
      />
    );
  } else {
    content = (
      <>
        {mark ? (
          // eslint-disable-next-line @next/next/no-img-element -- pre-sized public WebP variants
          <img
            src={mark.src}
            srcSet={mark.srcSet}
            alt=""
            width={32}
            height={32}
            className={cn("shrink-0 object-contain", markClass)}
            decoding="async"
          />
        ) : (
          // A monogram: the initials on the primary.
          <span
            aria-hidden="true"
            className={cn(
              "bg-primary text-primary-foreground flex shrink-0 items-center justify-center font-sans font-extrabold",
              markClass,
            )}
          >
            {orgInitials(name)}
          </span>
        )}
        <span className={cn("min-w-0 leading-tight break-words", nameClass)}>{name}</span>
      </>
    );
  }

  const classes = cn("flex min-w-0 items-center text-sm", compact ? "gap-2" : "gap-2.5", className);
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          classes,
          "focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none",
        )}
      >
        {content}
      </Link>
    );
  }
  return <div className={classes}>{content}</div>;
}
