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
 *   (`hideNameOnly`, the app sidebar, whose org switcher carries the name).
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
  className,
}: {
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
  const mark = orgLogoSource(logo, 32);

  let content: React.ReactNode;
  if (display === "NAME_ONLY") {
    content = <span className="heading truncate text-[0.95rem]">{name}</span>;
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
            className="size-8 shrink-0 rounded-md object-contain"
            decoding="async"
          />
        ) : (
          // A two-ink monogram: initials in the primary, the accent off register.
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground misregister font-heading flex size-8 shrink-0 items-center justify-center rounded-md text-[0.8rem] font-black font-stretch-[125%]"
          >
            {orgInitials(name)}
          </span>
        )}
        <span className="heading truncate text-[0.95rem]">{name}</span>
      </>
    );
  }

  const classes = cn("flex min-w-0 items-center gap-2.5 text-sm", className);
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
