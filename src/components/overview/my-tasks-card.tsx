import { CircleCheck } from "@/components/icons";
import type { ReactNode } from "react";

import { dueLabel } from "@/lib/overview/format";
import { addDaysToKey, dueDateKey } from "@/lib/tasks/dates";
import { epicColor, epicOf } from "@/lib/tasks/epic";
import type { LinkedChip, TaskExtras } from "@/server/overview/queries";
import type { MyOpenTask } from "@/server/tasks/queries";

import { TaskRows, type TaskRowData } from "./task-rows";

/** At most this many chips under a task. */
const ROW_CHIPS = 3;

/**
 * The Overview's "My tasks" (redesign guide 9): one warning when your
 * deadlines pile up in the same week as a big event, then the tasks
 * themselves, soonest due first, each with chips for the event, meeting or
 * note it's linked to. The board's card header holds the count chip and ↗
 * (see the page).
 */

export function MyTasksCard({
  orgId,
  orgSlug,
  tasks,
  extras,
  todayKey,
  links,
  insight,
}: {
  orgId: string;
  orgSlug: string;
  tasks: readonly MyOpenTask[];
  extras: ReadonlyMap<string, TaskExtras>;
  todayKey: string;
  /** What each task is linked to, keyed "task:id". */
  links?: ReadonlyMap<string, readonly LinkedChip[]>;
  /** The one finding over the list (an Insight), when there is one. */
  insight?: ReactNode;
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
      late: task.dueDate ? dueDateKey(task.dueDate) < todayKey : false,
      startable:
        task.status === "NOT_STARTED" &&
        task.dueDate !== null &&
        dueDateKey(task.dueDate) >= todayKey &&
        dueDateKey(task.dueDate) <= addDaysToKey(todayKey, 2),
      high: extra?.priority === "HIGH",
      chips: (links?.get(`task:${task.id}`) ?? [])
        .filter((c) => !c.done)
        .slice(0, ROW_CHIPS)
        .map(({ kind, label, href }) => ({ kind, label, href })),
    };
  });
  return (
    <div className="space-y-4">
      {insight}
      <TaskRows orgId={orgId} tasks={rows} todayKey={todayKey} />
    </div>
  );
}
