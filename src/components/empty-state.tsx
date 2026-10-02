import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * What a page or card shows with nothing in it yet: what goes here, and the
 * next step to put something there (`action`: a button or link). "compact"
 * fits inside a card.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  size = "default",
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  size?: "default" | "compact";
}) {
  const compact = size === "compact";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 rounded-lg px-4 py-6" : "gap-3 rounded-xl border border-dashed p-10",
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "bg-primary/10 text-primary grid place-items-center rounded-full",
            compact ? "size-9" : "size-12",
          )}
        >
          <Icon className={compact ? "size-4" : "size-5"} aria-hidden="true" />
        </span>
      )}
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-muted-foreground text-sm text-balance">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}
