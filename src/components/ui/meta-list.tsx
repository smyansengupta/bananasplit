import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The facts under a title ("Thu, Oct 30", "Curry 340", "34 came"), the one
 * way the app strings them together. Never a middle dot between words:
 * as text they're joined with commas (`metaLine`), and as UI they're
 * separate spans with space between them (`<MetaList>`).
 */
export function metaLine(parts: readonly (ReactNode | string | null | undefined | false)[]) {
  return parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "").join(", ");
}

export function MetaList({
  items,
  className,
}: {
  items: readonly ReactNode[];
  className?: string;
}) {
  const shown = items.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  if (shown.length === 0) return null;
  return (
    <span
      className={cn(
        "text-muted-foreground inline-flex flex-wrap items-center gap-x-3 gap-y-1",
        className,
      )}
    >
      {shown.map((item, i) => (
        <Fragment key={i}>
          <span className="min-w-0 break-words">{item}</span>
        </Fragment>
      ))}
    </span>
  );
}
