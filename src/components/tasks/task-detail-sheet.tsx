"use client";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { TaskEditor, type TaskEditorDefaults } from "./task-editor";
import type { TaskItem } from "./types";

/**
 * The one task surface: a centred window, the same size as New task (and
 * drawn with the same head, fields and foot), like the epic
 * dialog, so creating and editing always happen in the same place in the
 * middle of the screen (never a panel from the side). Its body scrolls;
 * the header and footer stay put.
 *
 * It renders once, at the top of the workspace, and every layout opens it
 * through useTasks().openTask / showTask. Purely presentational: the
 * provider owns which task is shown, and the editor draws the panel's
 * header, body and footer.
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
  const heading = task ? task.title : defaults?.parentTaskId ? "New subtask" : "New task";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-busy={busy}
        showCloseButton={false}
        className="flex max-h-[min(94vh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <DialogTitle className="sr-only">{heading}</DialogTitle>
        <DialogDescription className="sr-only">
          Edit this task, its people, its subtasks, its comments and who can see it.
        </DialogDescription>
        {open && (
          <TaskEditor
            key={
              task?.id ??
              `new-${defaults?.parentTaskId ?? "top"}-${defaults?.status ?? ""}-${defaults?.type ?? ""}-${defaults?.dueDate ?? ""}`
            }
            task={task}
            defaults={defaults}
            onDone={() => onOpenChange(false)}
            onOpenTask={onOpenTask}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
