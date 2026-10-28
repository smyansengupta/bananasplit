"use client";

import { CalendarDays, CircleAlert, SquareCheckBig, Ticket } from "@/components/icons";

import { OpenTasksBar, taskStatsSegments } from "@/components/tasks/open-tasks-bar";
import { Badge } from "@/components/ui/badge";
import { Stat, StatStrip } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import type { TaskStats } from "@/server/tasks/queries";

/**
 * The stat strip under the greeting on every Overview, a club's and the
 * Personal home alike (redesign guide 7.4, 9): your tasks due this week
 * (with what's due today), overdue (or "All clear"), what's on the
 * calendar in the next two weeks and, at home, your RSVPs. A client
 * component so it can hand icon components to Stat; pages pass plain numbers.
 */
export function OverviewStats({
  dueSoon,
  dueToday,
  overdue,
  upcoming,
  upcomingDays,
  rsvps,
  taskBar,
  tasksHref,
  className,
}: {
  dueSoon: number;
  dueToday: number;
  overdue: number;
  upcoming: number;
  upcomingDays: number;
  /** The Personal home only. */
  rsvps?: number;
  /** Tasks' stat strip numbers (getTaskStats): a phone shows them as Tasks' bar instead. */
  taskBar?: TaskStats;
  /** Tasks, where that bar leads. */
  tasksHref?: string;
  className?: string;
}) {
  return (
    <>
      {/* A phone: the very same bar as Tasks' (the organization's tasks, the same split). */}
      {taskBar && (
        <OpenTasksBar
          open={taskBar.open}
          href={tasksHref}
          className="md:hidden"
          segments={taskStatsSegments(taskBar)}
        />
      )}
      <StatStrip className={cn(taskBar && "max-md:hidden", className)}>
        <Stat
          icon={SquareCheckBig}
          value={dueSoon}
          label="Due this week"
          chip={dueToday > 0 ? <Badge variant="accent">{dueToday} due today</Badge> : undefined}
        />
        <Stat
          icon={CircleAlert}
          value={overdue}
          label="Overdue"
          chip={overdue === 0 ? <Badge variant="success">All clear</Badge> : undefined}
        />
        <Stat icon={CalendarDays} value={upcoming} label={`Coming up in ${upcomingDays} days`} />
        {rsvps !== undefined && <Stat icon={Ticket} value={rsvps} label="RSVPs" />}
      </StatStrip>
    </>
  );
}
