"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { TaskCard, type TaskCardData } from "@/components/tasks/task-card";

export function SortableTaskCard({
  task,
  todayKey,
  onOpen,
}: {
  task: TaskCardData;
  todayKey: string;
  onOpen: (taskId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        "group focus-visible:ring-ring cursor-grab rounded-lg focus-visible:ring-2 focus-visible:outline-none active:cursor-grabbing" +
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
    </div>
  );
}
