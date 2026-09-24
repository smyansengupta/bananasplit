"use client";

import { useRouter } from "next/navigation";

import type { TaskCommentItem } from "@/server/tasks/queries";

import { TaskEditor } from "./task-editor";
import { useTasks } from "./tasks-context";
import type { TaskItem } from "./types";

/** The editor on a task's own page: subtasks and the parent open as pages. */
export function TaskPageEditor({
  task,
  initialComments,
}: {
  task: TaskItem;
  initialComments: { comments: TaskCommentItem[]; hasMore: boolean };
}) {
  const router = useRouter();
  const { org } = useTasks();
  return (
    <TaskEditor
      key={`${task.id}-${task.version}`}
      task={task}
      mode="page"
      initialComments={initialComments}
      onOpenTask={(id) => router.push(`/app/${org.slug}/tasks/${id}`)}
      onDeleted={() => router.push(`/app/${org.slug}/tasks`)}
    />
  );
}
