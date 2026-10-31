import type { CSSProperties, ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The pieces every Tasks layout shares (week, board, table, calendar, team),
 * so switching layouts changes the shape of the page, not its look: one
 * panel surface, one group header, and one colour per status (the calendar
 * legend uses the same).
 */

export const STATUS_TOKEN: Record<string, string> = {
  NOT_STARTED: "var(--muted-foreground)",
  IN_PROGRESS: "var(--chart-1)",
  BLOCKED: "var(--destructive)",
  COMPLETED: "var(--success)",
};

export const STATUS_LABEL: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  COMPLETED: "Done",
};

/** The surface a list of tasks sits on. */
export const TASK_PANEL = "bg-card edge rounded-card p-2 max-sm:p-1.5";

export function GroupHeader({
  id,
  title,
  count,
  dot,
  tone,
  description,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  count: number;
  /** A CSS colour for the leading dot (a status token). */
  dot?: string;
  tone?: "danger" | "warning";
  description?: ReactNode;
  /** Actions on the right. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 px-1", className)}>
      {dot && (
        <span
          className="size-2 shrink-0 rounded-full shadow-[0_0_0_3px_color-mix(in_oklab,var(--dot)_24%,transparent)]"
          style={{ background: dot, "--dot": dot } as CSSProperties}
          aria-hidden="true"
        />
      )}
      <h2
        id={id}
        className={cn(
          "truncate text-sm font-semibold",
          tone === "danger" && "text-tint-danger-foreground",
          tone === "warning" && "text-warning",
        )}
      >
        {title}
      </h2>
      <Badge variant="secondary" className="tabular-nums">
        {count}
      </Badge>
      {description && (
        <span className="text-muted-foreground hidden truncate text-xs sm:inline">
          {description}
        </span>
      )}
      {children && <span className="ms-auto flex items-center gap-1">{children}</span>}
    </div>
  );
}
