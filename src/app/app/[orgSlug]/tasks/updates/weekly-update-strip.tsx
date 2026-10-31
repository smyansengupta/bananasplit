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
 * The weekly update, where it belongs: on top of the Week, which is the
 * same question (what you did, what's next, what's stuck) the update
 * answers. One line and one button; it used to be a header button that sat
 * there all week whether or not it was due.
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
        <span className="font-medium">Weekly update</span>{" "}
        <span className="text-muted-foreground">
          {status.posted
            ? "· posted for this week"
            : `· due ${formatDueKey(dueKey, status.todayKey)}${late ? " (late)" : ""}. Done, next and blocked are drafted from your tasks.`}
        </span>
      </p>
      <Button asChild size="sm" variant={status.posted ? "ghost" : "default"}>
        <Link href={href}>{status.posted ? "View or edit" : "Write it"}</Link>
      </Button>
    </div>
  );
}
