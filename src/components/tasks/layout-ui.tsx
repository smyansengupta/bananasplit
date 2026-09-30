import type { ReactNode } from "react";

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
export const TASK_PANEL = "bg-card overflow-hidden rounded-xl border shadow-xs";

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
      {dot && <span className="size-2 shrink-0 rounded-full" style={{ background: dot }} aria-hidden="true" />}
      <h2
        id={id}
        className={cn(
          "truncate text-sm font-semibold tracking-tight",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-warning",
        )}
      >
        {title}
      </h2>
      <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-[11px] font-medium tabular-nums">
        {count}
      </span>
      {description && (
        <span className="text-muted-foreground hidden truncate text-xs sm:inline">{description}</span>
      )}
      {children && <span className="ms-auto flex items-center gap-1">{children}</span>}
    </div>
  );
}
