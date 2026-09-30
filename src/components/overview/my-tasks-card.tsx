import { Ban, CircleCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { DueLabel, PrivateMark, isTaskPrivate } from "@/components/tasks/task-badges";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TaskStatus } from "@/generated/prisma/enums";
import { dueDateKey, formatDueKey } from "@/lib/tasks/dates";
import type { MyOpenTask } from "@/server/tasks/queries";

/**
 * The overview's "My tasks": what the viewer owns or is on, soonest due
 * first. Overdue and blocked say so in words beside their icon.
 */
export function MyTasksCard({
  orgSlug,
  tasks,
  total,
  overdue,
  todayKey,
  className,
  bare = false,
}: {
  orgSlug: string;
  tasks: readonly MyOpenTask[];
  total: number;
  overdue: number;
  todayKey: string;
  className?: string;
  /** Inside a board widget, which has its own frame and title. */
  bare?: boolean;
}) {
  if (bare) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {total} open
            {overdue > 0 && <span className="text-destructive"> · {overdue} overdue</span>}
          </span>
          <Link href={`/app/${orgSlug}/tasks?view=mine`} className="text-muted-foreground hover:underline">
            {total > tasks.length ? `View all ${total}` : "View all"}
          </Link>
        </div>
        {tasks.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <CircleCheck className="size-4" aria-hidden="true" />
            You&apos;re all caught up: nothing open is yours.
          </p>
        ) : (
          <ul className="divide-y">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/app/${orgSlug}/tasks/${task.id}`}
                  className="hover:bg-accent/50 -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {isTaskPrivate(task) && <PrivateMark />}
                      <span className="truncate">{task.title}</span>
                    </span>
                    <TaskMeta task={task} />
                  </span>
                  <TaskDue dueDate={task.dueDate} todayKey={todayKey} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">My tasks</CardTitle>
        {total > 0 && (
          <CardDescription>
            {total} open
            {overdue > 0 && (
              <>
                {" · "}
                <span className="text-destructive inline-flex items-center gap-1 align-bottom">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  {overdue} overdue
                </span>
              </>
            )}
          </CardDescription>
        )}
        <CardAction>
          <Link
            href={`/app/${orgSlug}/tasks?view=mine`}
            className="text-muted-foreground text-sm hover:underline"
          >
            {total > tasks.length ? `View all ${total}` : "View all"}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {tasks.length === 0 ? (
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <CircleCheck className="size-4" aria-hidden="true" />
            You&apos;re all caught up: nothing open is yours.
          </p>
        ) : (
          <ul className="divide-y">
            {tasks.map((task) => (
              <li key={task.id}>
                <Link
                  href={`/app/${orgSlug}/tasks/${task.id}`}
                  className="hover:bg-accent/50 -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {isTaskPrivate(task) && <PrivateMark />}
                      <span className="truncate">{task.title}</span>
                    </span>
                    <TaskMeta task={task} />
                  </span>
                  <TaskDue dueDate={task.dueDate} todayKey={todayKey} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TaskMeta({ task }: { task: MyOpenTask }) {
  const context = [task.parentTask && `Subtask of ${task.parentTask.title}`, task.project?.name]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
      {task.status === TaskStatus.BLOCKED ? (
        <span className="text-destructive inline-flex shrink-0 items-center gap-1">
          <Ban className="size-3" aria-hidden="true" />
          Blocked
        </span>
      ) : (
        <span className="shrink-0">
          {task.status === TaskStatus.IN_PROGRESS ? "In progress" : "Not started"}
        </span>
      )}
      {context && <span className="truncate">· {context}</span>}
    </span>
  );
}

function TaskDue({ dueDate, todayKey }: { dueDate: Date | null; todayKey: string }) {
  if (!dueDate) {
    return <span className="text-muted-foreground shrink-0 text-xs">No due date</span>;
  }
  const key = dueDateKey(dueDate);
  if (key < todayKey) {
    return (
      <span className="text-destructive inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap">
        <TriangleAlert className="size-3.5" aria-hidden="true" />
        Overdue · {formatDueKey(key, todayKey)}
      </span>
    );
  }
  // DueLabel says "Today" in its own tone; later dates stay muted.
  return (
    <span className="text-muted-foreground shrink-0 text-xs">
      <DueLabel dueDate={dueDate} todayKey={todayKey} />
    </span>
  );
}
