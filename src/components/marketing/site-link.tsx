import Link from "next/link";

/**
 * A link to an app route (next/link, so it prefetches) or to anything else:
 * a section of this page, or one of the placeholder destinations in
 * @/lib/brand/links, which may turn into a mailto or another site. `data-*`
 * attributes (the CTA tracker's `data-cta`) pass through.
 */
export function SiteLink({
  href,
  className,
  children,
  ...data
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
} & { [key: `data-${string}`]: string | undefined }) {
  return href.startsWith("/") ? (
    <Link href={href} className={className} {...data}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className} {...data}>
      {children}
    </a>
  );
}
