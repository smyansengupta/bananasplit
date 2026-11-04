import type { IconComponent } from "@/components/icons";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * What a page or card shows with nothing in it yet: what goes here, and the
 * next step to put something there (`action`: a button or link). The
 * section's icon (optional) sits in a large circle above one sentence and
 * one button. "compact" fits inside a card, left-aligned and without the
 * circle.
 */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
  className,
  size = "default",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** The section's own icon (Tasks' check, Calendar's calendar...). */
  icon?: IconComponent;
  className?: string;
  size?: "default" | "compact";
}) {
  const compact = size === "compact";
  return (
    <div
      className={cn(
        compact ? "space-y-1.5 py-4" : "flex flex-col items-center gap-2.5 px-4 py-10 text-center",
        className,
      )}
    >
      {Icon && !compact && (
        <span className="bg-muted text-muted-foreground mb-1 grid size-14 place-items-center rounded-full">
          <Icon className="size-6" aria-hidden="true" />
        </span>
      )}
      <p className={cn("heading", compact ? "text-sm" : "text-[15px]")}>{title}</p>
      {description && (
        <p
          className={cn("text-muted-foreground text-sm", compact ? "max-w-prose" : "max-w-[34ch]")}
        >
          {description}
        </p>
      )}
      {action && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-2",
            compact ? "pt-1.5" : "justify-center pt-1",
          )}
        >
          {action}
        </div>
      )}
    </div>
  );
}
