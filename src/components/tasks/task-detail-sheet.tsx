"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import { isTaskPrivate, PrivateBadge } from "./task-badges";
import { TaskEditor, type TaskEditorDefaults } from "./task-editor";
import type { TaskItem } from "./types";

/**
 * The one task surface.
 *
 * A side panel rather than a centred modal: you keep the list you came from
 * in view, which matters when you are working down a week or dragging a
 * board. On a phone it takes the full width, because there is nothing to
 * keep in view anyway.
 *
 * It renders once, at the top of the workspace, and every layout opens it
 * through useTasks().openTask / showTask. Purely presentational: the
 * provider owns which task is shown.
 */
export function TaskDetailSheet({
  open,
  onOpenChange,
  task,
  defaults,
  onOpenTask,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskItem | null;
  defaults?: TaskEditorDefaults;
  onOpenTask: (taskId: string) => void;
  busy?: boolean;
}) {
  const heading = task
    ? task.parentTaskId
      ? "Subtask"
      : "Task"
    : defaults?.parentTaskId
      ? "New subtask"
      : "New task";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        aria-busy={busy}
        className="w-full gap-0 overflow-y-auto p-0 sm:max-w-xl"
      >
        <SheetHeader className="bg-popover/95 sticky top-0 z-10 flex-row items-center gap-2 border-b px-4 py-3 pe-12 supports-backdrop-filter:backdrop-blur">
          <SheetTitle className="text-sm font-medium">{heading}</SheetTitle>
          {task && isTaskPrivate(task) && <PrivateBadge />}
          <SheetDescription className="sr-only">
            Edit this task, its people, its subtasks, its comments and who can see it.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 py-5">
          {open && (
            <TaskEditor
              key={
                task?.id ??
                `new-${defaults?.parentTaskId ?? "top"}-${defaults?.status ?? ""}-${defaults?.projectId ?? ""}-${defaults?.dueDate ?? ""}`
              }
              task={task}
              defaults={defaults}
              onDone={() => onOpenChange(false)}
              onOpenTask={onOpenTask}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
