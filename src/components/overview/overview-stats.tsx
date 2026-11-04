"use client";

import { CalendarDays, CircleAlert, SquareCheckBig, Ticket } from "@/components/icons";
import Link from "next/link";
import type { ReactNode } from "react";

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
 * Each number with a list behind it opens that list (your tasks due this
 * week, your overdue ones, the calendar).
 */

/** A stat that opens its list, or just the stat when there's nowhere to go. */
function Linked({ href, label, children }: { href?: string; label: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  return (
    <Link
      href={href}
      aria-label={label}
      className="focus-glow rounded-tile hover:bg-muted/60 -m-1.5 p-1.5 transition-colors outline-none"
    >
      {children}
    </Link>
  );
}
export function OverviewStats({
  dueSoon,
  dueToday,
  overdue,
  upcoming,
  upcomingDays,
  rsvps,
  taskBar,
  tasksHref,
  calendarHref,
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
  /** Tasks, where that bar leads (and the task stats open, filtered to you). */
  tasksHref?: string;
  /** The calendar, where "Next 14 days" opens. */
  calendarHref?: string;
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
        <Linked
          href={tasksHref ? `${tasksHref}?scope=mine` : undefined}
          label={`${dueSoon} due this week`}
        >
          <Stat
            icon={SquareCheckBig}
            value={dueSoon}
            label="Due this week"
            chip={dueToday > 0 ? <Badge variant="accent">{dueToday} due today</Badge> : undefined}
          />
        </Linked>
        <Linked
          href={tasksHref && overdue > 0 ? `${tasksHref}?scope=mine&overdue=1` : undefined}
          label={`${overdue} overdue`}
        >
          <Stat
            icon={CircleAlert}
            value={overdue}
            label="Overdue"
            chip={overdue === 0 ? <Badge variant="success">All clear</Badge> : undefined}
          />
        </Linked>
        <Linked href={calendarHref} label={`${upcoming} in the next ${upcomingDays} days`}>
          <Stat icon={CalendarDays} value={upcoming} label={`Next ${upcomingDays} days`} />
        </Linked>
        {rsvps !== undefined && <Stat icon={Ticket} value={rsvps} label="RSVPs" />}
      </StatStrip>
    </>
  );
}
