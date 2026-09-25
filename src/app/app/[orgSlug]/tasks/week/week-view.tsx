"use client";

import { Ban, CalendarX2, CheckCircle2, ChevronRight, TriangleAlert } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { TaskRow } from "@/components/tasks/task-row";
import { useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { TaskStatus } from "@/generated/prisma/enums";
import { addDaysToKey, dueDateKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

/**
 * The Week: what is owed, and by when.
 *
 * This replaces "My Tasks" and generalises it. The old view answered one
 * question — what am I on — grouped Overdue / Blocked / Today / This week /
 * Later. The grouping was right; the scope was too narrow. A club board
 * spends Sunday asking the same question about the whole team, so the
 * grouping stays and the scope chip in the toolbar decides whose week it is.
 *
 * Blocked is deliberately NOT a time bucket here. A blocked task still has a
 * due date, and hiding it in a bucket of its own is how a blocker survives
 * three weeks unnoticed. It sits in its real bucket with its reason showing,
 * and the count line at the top offers one click to see only those.
 */

interface Bucket {
  key: string;
  label: string;
  description?: string;
  tasks: TaskItem[];
  tone?: "overdue" | "today";
}

function bucketize(tasks: TaskItem[], todayKey: string): Bucket[] {
  const tomorrow = addDaysToKey(todayKey, 1);
  const weekEnd = addDaysToKey(todayKey, 7);
  const overdue: TaskItem[] = [];
  const today: TaskItem[] = [];
  const tomorrowTasks: TaskItem[] = [];
  const week: TaskItem[] = [];
  const later: TaskItem[] = [];
  const undated: TaskItem[] = [];

  for (const task of tasks) {
    if (!task.dueDate) {
      undated.push(task);
      continue;
    }
    const key = dueDateKey(task.dueDate);
    if (key < todayKey) overdue.push(task);
    else if (key === todayKey) today.push(task);
    else if (key === tomorrow) tomorrowTasks.push(task);
    else if (key <= weekEnd) week.push(task);
    else later.push(task);
  }

  const buckets: Bucket[] = [
    { key: "overdue", label: "Overdue", tasks: overdue, tone: "overdue" },
    { key: "today", label: "Today", tasks: today, tone: "today" },
    { key: "tomorrow", label: "Tomorrow", tasks: tomorrowTasks },
    { key: "week", label: "Next 7 days", tasks: week },
    { key: "later", label: "Later", tasks: later },
    {
      key: "undated",
      label: "No due date",
      description: "Give these a date or they never surface.",
      tasks: undated,
    },
  ];
  return buckets.filter((b) => b.tasks.length > 0);
}

export function WeekView({
  open,
  completed,
  hasMore,
  moreLimit,
}: {
  open: TaskItem[];
  completed: TaskItem[];
  hasMore: boolean;
  moreLimit: number;
}) {
  const { org, viewer, newTask } = useTasks();
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showDone, setShowDone] = useState(false);

  function showMore() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("limit", String(moreLimit));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const buckets = bucketize(open, org.todayKey);
  const overdue = buckets.find((b) => b.key === "overdue")?.tasks.length ?? 0;
  const dueToday = buckets.find((b) => b.key === "today")?.tasks.length ?? 0;
  const blocked = open.filter((t) => t.status === TaskStatus.BLOCKED).length;
  const flagged = open.filter(
    (t) => t.ownerFlagged || t.assignees.some((a) => a.flagged && !a.flagAcknowledgedAt),
  ).length;

  const mine = ws.query.scope === "mine";
  const whose = mine ? "You" : ws.query.scope === "team" ? "Your team" : "The club";

  if (open.length === 0 && completed.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title={
          ws.filterCount > 0
            ? "Nothing matches those filters"
            : mine
              ? "Nothing on your plate"
              : "Nothing open here"
        }
        description={
          ws.filterCount > 0
            ? "Loosen a filter, or clear them all to see the whole week."
            : mine
              ? "Nothing open is assigned to you. Switch to Everyone to see what the club is carrying, or start something."
              : "No open tasks in this scope yet."
        }
        action={
          ws.filterCount > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                ws.setFilters({
                  status: undefined,
                  labelId: undefined,
                  q: undefined,
                  flagged: false,
                  blockers: false,
                  visibility: undefined,
                })
              }
            >
              Clear filters
            </Button>
          ) : (
            <Button size="sm" onClick={() => newTask()}>
              New task
            </Button>
          )
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* The whole week in one line, each number a filter. */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-sm">
        <span className="text-muted-foreground">
          {whose} {open.length === 1 ? "has" : "have"}
        </span>
        <strong className="font-semibold">{open.length} open</strong>
        {overdue > 0 && (
          <CountChip
            tone="overdue"
            icon={CalendarX2}
            label={`${overdue} overdue`}
            active={false}
            onClick={() =>
              document
                .getElementById("bucket-overdue")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          />
        )}
        {dueToday > 0 && (
          <CountChip
            tone="today"
            label={`${dueToday} due today`}
            active={false}
            onClick={() =>
              document
                .getElementById("bucket-today")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          />
        )}
        {blocked > 0 && (
          <CountChip
            tone="blocked"
            icon={Ban}
            label={`${blocked} blocked`}
            active={ws.query.status === TaskStatus.BLOCKED}
            onClick={() =>
              ws.setFilters({
                status: ws.query.status === TaskStatus.BLOCKED ? undefined : TaskStatus.BLOCKED,
              })
            }
          />
        )}
        {flagged > 0 && (
          <CountChip
            tone="flagged"
            icon={TriangleAlert}
            label={`${flagged} flagged`}
            active={ws.query.flagged}
            onClick={() => ws.setFilters({ flagged: !ws.query.flagged })}
          />
        )}
      </div>

      {buckets.map((bucket) => (
        <section
          key={bucket.key}
          id={`bucket-${bucket.key}`}
          aria-labelledby={`bucket-${bucket.key}-title`}
        >
          <div className="mb-1.5 flex items-baseline gap-2">
            <h2
              id={`bucket-${bucket.key}-title`}
              className={cn(
                "text-sm font-semibold tracking-tight",
                bucket.tone === "overdue" && "text-destructive",
                bucket.tone === "today" && "text-warning",
              )}
            >
              {bucket.label}
            </h2>
            <span className="text-muted-foreground text-xs tabular-nums">
              {bucket.tasks.length}
            </span>
            {bucket.description && (
              <span className="text-muted-foreground hidden text-xs sm:inline">
                {bucket.description}
              </span>
            )}
          </div>
          <ul className="divide-border bg-card divide-y overflow-hidden rounded-lg border">
            {bucket.tasks.map((task) => (
              <TaskRow key={task.id} task={task} showOwner={!mine} />
            ))}
          </ul>
        </section>
      ))}

      {hasMore && (
        <Button variant="outline" size="sm" onClick={showMore}>
          Show more open tasks
        </Button>
      )}

      {completed.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="text-muted-foreground hover:text-foreground group -mx-1 flex items-center gap-1.5 rounded px-1 py-1 text-sm font-medium transition-colors"
          >
            <ChevronRight
              className={cn("size-4 transition-transform duration-150", showDone && "rotate-90")}
              aria-hidden="true"
            />
            Done in the last 7 days
            <span className="text-xs tabular-nums">{completed.length}</span>
          </button>
          {showDone && (
            <ul className="divide-border bg-card mt-1.5 divide-y overflow-hidden rounded-lg border">
              {completed.map((task) => (
                <TaskRow key={task.id} task={task} showOwner={!mine} />
              ))}
            </ul>
          )}
        </section>
      )}

      {viewer.isAdmin && open.length > 0 && ws.query.scope !== "mine" && (
        <p className="text-muted-foreground text-xs">
          Counts are what you can see. A private task you are not on is not in here.
        </p>
      )}
    </div>
  );
}

function CountChip({
  label,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone: "overdue" | "today" | "blocked" | "flagged";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "focus-visible:ring-ring inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:outline-none",
        tone === "overdue" && "bg-destructive/10 text-destructive hover:bg-destructive/20",
        tone === "today" && "bg-warning/15 text-warning hover:bg-warning/25",
        tone === "blocked" && "bg-destructive/10 text-destructive hover:bg-destructive/20",
        tone === "flagged" && "bg-warning/15 text-warning hover:bg-warning/25",
        active && "ring-1 ring-current",
      )}
    >
      {Icon && <Icon className="size-3" />}
      {label}
    </button>
  );
}
