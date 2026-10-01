"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { TaskCard } from "@/components/tasks/task-card";
import { TaskItemMenu } from "@/components/tasks/task-item-menu";
import { accessSubjectOf, useTasks } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { canEditTask } from "@/lib/tasks/access";

export function SortableTaskCard({
  task,
  todayKey,
  onOpen,
}: {
  task: TaskItem;
  todayKey: string;
  onOpen: (taskId: string) => void;
}) {
  const { actor } = useTasks();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        "group focus-visible:ring-ring relative cursor-grab rounded-lg focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing" +
        (isDragging ? " opacity-40" : "")
      }
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        // Space/Enter both pick up/drop for drag (handled by dnd-kit's own
        // listeners below) and would otherwise "click" a real button — since
        // this is a plain div there's no such double-fire to guard against,
        // but Enter should still open the task like a real button would.
        if (e.key === "Enter") onOpen(task.id);
      }}
      {...attributes}
      {...listeners}
    >
      <TaskCard task={task} todayKey={todayKey} />
      {/* The menu keeps its own clicks and drags (ItemMenu stops them). */}
      <TaskItemMenu
        task={{ id: task.id, title: task.title, subtaskCount: task.subtasks.length }}
        editable={canEditTask(actor, accessSubjectOf(task))}
        onOpen={() => onOpen(task.id)}
        className="bg-card absolute top-1.5 right-1.5 border opacity-0 shadow-xs group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
      />
    </div>
  );
}
