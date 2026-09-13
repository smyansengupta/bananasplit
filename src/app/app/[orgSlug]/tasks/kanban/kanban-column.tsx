"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { cn } from "@/lib/utils";
import type { TaskCardData } from "@/components/tasks/task-card";

import { SortableTaskCard } from "./sortable-task-card";

export function KanbanColumn({
  id,
  title,
  tasks,
  onOpenTask,
  onAddTask,
}: {
  id: string;
  title: string;
  tasks: TaskCardData[];
  onOpenTask: (taskId: string) => void;
  onAddTask: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex w-72 shrink-0 flex-col gap-3 sm:w-80">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-medium">
          {title} <span className="text-muted-foreground">({tasks.length})</span>
        </h2>
        <button
          type="button"
          onClick={onAddTask}
          className="text-muted-foreground hover:text-foreground text-sm"
          aria-label={`Add task to ${title}`}
        >
          + Add
        </button>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-24 flex-1 space-y-2 rounded-lg border border-dashed p-2 transition-colors",
          isOver && "border-ring bg-accent/40",
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onOpen={onOpenTask} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}
