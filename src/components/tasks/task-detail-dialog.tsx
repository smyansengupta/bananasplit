"use client";

import { useState, useTransition } from "react";

import { loadTaskDetail } from "@/app/app/[orgSlug]/tasks/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { TaskEditor, type TaskEditorDefaults } from "./task-editor";
import { useTasks } from "./tasks-context";
import type { TaskItem } from "./types";

/**
 * The task dialog. It only decides whether to render; the editor inside is
 * keyed on the task (or the create defaults), so opening a different task
 * remounts it with fresh state. Subtask rows and the parent breadcrumb open
 * that task in the same dialog.
 */
export function TaskDetailDialog({
  open,
  onOpenChange,
  task,
  defaults,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The task to edit, or null to create one. */
  task: TaskItem | null;
  defaults?: TaskEditorDefaults;
}) {
  const { org, announce } = useTasks();
  const [other, setOther] = useState<TaskItem | null>(null);
  const [isLoading, startTransition] = useTransition();
  const shown = other ?? task;

  function openTask(taskId: string) {
    startTransition(async () => {
      const loaded = await loadTaskDetail(org.id, taskId);
      if (!loaded) {
        announce("That task is no longer available.");
        return;
      }
      setOther(loaded);
    });
  }

  function handleOpenChange(next: boolean) {
    if (!next) setOther(null);
    onOpenChange(next);
  }

  const heading = shown ? (shown.parentTaskId ? "Subtask" : "Task") : defaults?.parentTaskId ? "New subtask" : "New task";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" aria-busy={isLoading}>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription className="sr-only">Task details</DialogDescription>
        </DialogHeader>
        {open && (
          <TaskEditor
            key={shown?.id ?? `new-${defaults?.parentTaskId ?? "top"}-${defaults?.status ?? ""}-${defaults?.projectId ?? ""}`}
            task={shown}
            defaults={defaults}
            onDone={() => handleOpenChange(false)}
            onOpenTask={openTask}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
