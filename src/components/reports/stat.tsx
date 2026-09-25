import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A stat tile: label (sentence case), value (proportional figures), an
 * optional detail line. With `href` the whole tile links to the rows behind
 * the number.
 */
export function Stat({
  label,
  value,
  detail,
  href,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: string | null;
  className?: string;
}) {
  const body = (
    <>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-2xl leading-tight font-semibold">{value}</span>
      {detail ? <span className="text-muted-foreground text-xs">{detail}</span> : null}
    </>
  );
  const base = "flex min-w-0 flex-col gap-0.5 rounded-lg bg-muted/50 px-3 py-2.5";
  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          base,
          "hover:bg-muted focus-visible:ring-ring/50 outline-none transition-colors focus-visible:ring-3",
          className,
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={cn(base, className)}>{body}</div>;
}

export function StatRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)}>{children}</div>;
}
