import { Ban, CalendarClock, TriangleAlert } from "lucide-react";

import { dueDateKey, formatDueKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

import type { TaskItem } from "./types";

/** Small presentational pieces shared by the card, table, dialog and lists. */

export const PRIORITY_LABELS: Record<string, string> = { LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

/** Whether the task carries an unacknowledged above-level flag. */
export function isTaskFlagged(task: Pick<TaskItem, "ownerFlagged" | "assignees">): boolean {
  return task.ownerFlagged || task.assignees.some((a) => a.flagged && !a.flagAcknowledgedAt);
}

export function FlagBadge({ className, label = "Flagged" }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
        className,
      )}
      title="Assigned above the assigner's level in the org chart"
    >
      <TriangleAlert className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export function BlockedNote({ reason, className }: { reason: string | null; className?: string }) {
  return (
    <span className={cn("text-destructive inline-flex items-start gap-1 text-xs", className)}>
      <Ban className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
      <span className="line-clamp-2">{reason ?? "Blocked"}</span>
    </span>
  );
}

export function DueLabel({
  dueDate,
  todayKey,
  done,
  className,
}: {
  dueDate: Date | null;
  todayKey: string;
  done?: boolean;
  className?: string;
}) {
  if (!dueDate) return null;
  const key = dueDateKey(dueDate);
  const overdue = !done && key < todayKey;
  const today = !done && key === todayKey;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        overdue && "text-destructive font-medium",
        today && "font-medium text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <CalendarClock className="size-3.5" aria-hidden="true" />
      {today ? "Today" : formatDueKey(key, todayKey)}
    </span>
  );
}

export function PriorityDot({ priority }: { priority: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        priority === "HIGH" ? "bg-red-500" : priority === "MEDIUM" ? "bg-amber-400" : "bg-slate-300",
      )}
    />
  );
}
