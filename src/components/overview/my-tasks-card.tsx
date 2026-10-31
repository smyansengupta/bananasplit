import { CircleCheck } from "@/components/icons";

import { dueLabel } from "@/lib/overview/format";
import { dueDateKey } from "@/lib/tasks/dates";
import { epicColor, epicOf } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";
import type { TaskExtras } from "@/server/overview/queries";
import type { MyOpenTask } from "@/server/tasks/queries";

import { TaskRows, type TaskRowData } from "./task-rows";

/**
 * The Overview's "My tasks" (redesign guide 9): first the shape of the
 * week, how many of the viewer's open tasks fall due each day with what's
 * late on the left, then the tasks themselves, soonest due first. The
 * board's card header holds the count chip and ↗ (see the page).
 */

export interface DueDay {
  key: string;
  /** "Late", "Today", "Sun". */
  label: string;
  count: number;
  tone: "late" | "today" | "day";
}

const BAR_MAX = 44;

/** Tasks due per day, as columns: late in the danger colour, today in the accent. */
export function DueStrip({ days }: { days: readonly DueDay[] }) {
  const most = Math.max(1, ...days.map((d) => d.count));
  return (
    <ol
      aria-label={`Due: ${days.map((d) => `${d.label} ${d.count}`).join(", ")}`}
      className="grid grid-cols-8 items-end gap-1.5"
    >
      {days.map((d) => {
        const h = d.count === 0 ? 4 : Math.max(10, (d.count / most) * BAR_MAX);
        return (
          <li key={d.key} className="flex min-w-0 flex-col items-center gap-1.5" aria-hidden="true">
            <span
              className={cn(
                "text-[13px] leading-none font-semibold tabular-nums",
                d.count === 0 && "text-muted-foreground/60",
                d.tone === "late" && d.count > 0 && "text-tint-danger-foreground",
              )}
            >
              {d.count}
            </span>
            <span
              className={cn(
                "block w-full max-w-9 rounded-[5px] transition-[height] duration-500",
                d.count === 0
                  ? "bg-muted-strong"
                  : d.tone === "late"
                    ? "bg-tint-danger-foreground"
                    : d.tone === "today"
                      ? "bg-brand-accent"
                      : "bg-(--chart-1)",
              )}
              style={{ height: h }}
            />
            <span
              className={cn(
                "truncate text-[11.5px]",
                d.tone === "today" ? "text-foreground font-semibold" : "text-muted-foreground",
              )}
            >
              {d.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function MyTasksCard({
  orgId,
  orgSlug,
  tasks,
  extras,
  todayKey,
  strip,
}: {
  orgId: string;
  orgSlug: string;
  tasks: readonly MyOpenTask[];
  extras: ReadonlyMap<string, TaskExtras>;
  todayKey: string;
  /** Late, then today and the six days after it. */
  strip: readonly DueDay[];
}) {
  if (tasks.length === 0) {
    return (
      <div className="flex items-center gap-3 py-3">
        <span className="bg-tint-success text-tint-success-foreground grid size-10 place-items-center rounded-full">
          <CircleCheck className="size-5" aria-hidden="true" />
        </span>
        <div>
          <p className="heading text-sm">All clear</p>
          <p className="text-muted-foreground text-[13px]">Nothing open is yours.</p>
        </div>
      </div>
    );
  }
  const rows: TaskRowData[] = tasks.map((task) => {
    const extra = extras.get(task.id);
    const epic = epicOf({ ...task, type: "TASK" });
    return {
      id: task.id,
      title: task.title,
      href: `/app/${orgSlug}/tasks/${task.id}`,
      status: task.status,
      private: task.visibility === "PRIVATE",
      epic:
        epic && epic.id !== task.parentTask?.id
          ? { name: epic.title, color: epicColor(epic) }
          : null,
      // The epic or story it sits in (an epic shows as its chip when it's further up).
      context: task.parentTask ? `Part of ${task.parentTask.title}` : null,
      due: task.dueDate ? dueLabel(dueDateKey(task.dueDate), todayKey) : null,
      high: extra?.priority === "HIGH",
    };
  });
  return (
    <div className="space-y-4">
      {strip.some((d) => d.count > 0) && (
        <div className="bg-muted/45 rounded-tile px-4 pt-3.5 pb-3">
          <DueStrip days={strip} />
        </div>
      )}
      <TaskRows orgId={orgId} tasks={rows} />
    </div>
  );
}
