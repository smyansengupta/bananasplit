import { Ban, CalendarClock, Lock, TriangleAlert } from "lucide-react";

import { TaskVisibility } from "@/generated/prisma/enums";
import { dueDateKey, formatDueKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

import type { TaskItem } from "./types";

/** Small presentational pieces shared by the card, table, dialog and lists. */

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

/** Whether the task carries an unacknowledged above-level flag. */
export function isTaskFlagged(task: Pick<TaskItem, "ownerFlagged" | "assignees">): boolean {
  return task.ownerFlagged || task.assignees.some((a) => a.flagged && !a.flagAcknowledgedAt);
}

export function isTaskPrivate(task: { visibility: TaskVisibility }): boolean {
  return task.visibility === TaskVisibility.PRIVATE;
}

/**
 * C4. A private task has to be recognisable at a glance in every layout, so
 * the lock is always the first thing on the line — before the title, where
 * the eye already is — and never only a colour. Cards add a dashed edge,
 * which nothing else in the workspace uses.
 */
export function PrivateMark({ className }: { className?: string }) {
  return (
    <Lock
      className={cn("text-muted-foreground inline-block size-3.5 shrink-0 align-[-2px]", className)}
      aria-label="Private task"
    />
  );
}

export function PrivateBadge({
  className,
  label = "Private",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "bg-foreground/8 text-foreground/80 ring-border inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        className,
      )}
      title="Only this task's owner, the people on it, its creator and admins can see it"
    >
      <Lock className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export function FlagBadge({
  className,
  label = "Flagged",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "bg-warning/15 text-warning inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
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
        today && "text-warning font-medium",
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
        priority === "HIGH"
          ? "bg-destructive"
          : priority === "MEDIUM"
            ? "bg-warning"
            : "bg-muted-foreground/40",
      )}
    />
  );
}
