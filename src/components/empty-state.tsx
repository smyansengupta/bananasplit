import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * What a page or card shows with nothing in it yet: what goes here, and the
 * next step to put something there (`action`: a button or link). Set like a
 * paragraph in the page, not a placard: left-aligned text in the heading
 * face, no icon. "compact" fits inside a card.
 */
export function EmptyState({
  title,
  description,
  action,
  className,
  size = "default",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  size?: "default" | "compact";
}) {
  const compact = size === "compact";
  return (
    <div className={cn("space-y-1.5", compact ? "py-4" : "border-t py-8", className)}>
      <p className={cn("heading", compact ? "text-sm" : "text-base")}>{title}</p>
      {description && <p className="text-muted-foreground max-w-prose text-sm">{description}</p>}
      {action && <div className="flex flex-wrap items-center gap-2 pt-1.5">{action}</div>}
    </div>
  );
}
