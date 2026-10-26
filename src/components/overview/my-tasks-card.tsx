import { CircleCheck } from "@/components/icons";

import { dueLabel } from "@/lib/overview/format";
import { dueDateKey } from "@/lib/tasks/dates";
import { epicColor, epicOf } from "@/lib/tasks/epic";
import type { TaskExtras } from "@/server/overview/queries";
import type { MyOpenTask } from "@/server/tasks/queries";

import { TaskRows, type TaskRowData } from "./task-rows";

/**
 * The Overview's "My tasks" (redesign guide 9): what the viewer owns or is
 * on, soonest due first, as task rows. The board's card header holds the
 * count chip and ↗ (see the page).
 */
export function MyTasksCard({
  orgId,
  orgSlug,
  tasks,
  extras,
  todayKey,
}: {
  orgId: string;
  orgSlug: string;
  tasks: readonly MyOpenTask[];
  extras: ReadonlyMap<string, TaskExtras>;
  todayKey: string;
}) {
  if (tasks.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
        <CircleCheck className="size-4" aria-hidden="true" />
        You&apos;re all caught up: nothing open is yours.
      </p>
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
  return <TaskRows orgId={orgId} tasks={rows} />;
}
