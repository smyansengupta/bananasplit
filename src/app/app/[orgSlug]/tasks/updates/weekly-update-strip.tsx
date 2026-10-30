"use client";

import { CheckCircle2, NotebookPen } from "@/components/icons";
import Link from "next/link";

import { useTasks } from "@/components/tasks/tasks-context";
import { Button } from "@/components/ui/button";
import { addDaysToKey, formatDueKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

/** This week's update for the viewer: its week, its day, and whether it's posted. */
export interface WeeklyStatus {
  /** The week's first day (the day after the club's update day). */
  weekStart: string;
  /** The club's update day, 0 Sunday … 6 Saturday. */
  dueDay: number;
  posted: boolean;
  todayKey: string;
}

/**
 * The weekly update, on top of the Board and the List while it's still to
 * post: one line and one button. Once it's posted the strip goes (the
 * Dashboard and the update itself say so); it used to sit there all week.
 */
export function WeeklyUpdateStrip({ status }: { status: WeeklyStatus }) {
  const { org } = useTasks();
  const dueKey = addDaysToKey(status.weekStart, 6);
  const late = !status.posted && status.todayKey > dueKey;
  const href = `/app/${org.slug}/tasks?view=updates`;
  return (
    <div
      className={cn(
        "bg-card mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-2.5 text-sm",
        !status.posted && "border-primary/30",
      )}
    >
      {status.posted ? (
        <CheckCircle2 className="text-success size-4 shrink-0" aria-hidden="true" />
      ) : (
        <NotebookPen className="text-primary size-4 shrink-0" aria-hidden="true" />
      )}
      <p className="min-w-0 flex-1">
        <span className="font-medium">
          {status.posted ? "Weekly update posted" : "Weekly update due"}
        </span>{" "}
        {!status.posted && (
          <span className={cn(late ? "text-tint-danger-foreground" : "text-muted-foreground")}>
            {formatDueKey(dueKey, status.todayKey)}
            {late ? ", late" : ""}
          </span>
        )}
      </p>
      <Button asChild size="sm" variant={status.posted ? "ghost" : "default"}>
        <Link href={href}>{status.posted ? "Open" : "Write"}</Link>
      </Button>
    </div>
  );
}
