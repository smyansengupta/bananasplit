"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import type { TaskCardData } from "@/components/tasks/task-card";
import { cn } from "@/lib/utils";

import { SortableTaskCard } from "./sortable-task-card";

export function KanbanColumn({
  id,
  title,
  tasks,
  todayKey,
  onOpenTask,
  onAddTask,
  footer,
}: {
  id: string;
  title: string;
  tasks: TaskCardData[];
  todayKey: string;
  onOpenTask: (taskId: string) => void;
  onAddTask: () => void;
  footer?: React.ReactNode;
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
        data-testid={`kanban-column-${id}`}
        className={cn(
          "min-h-24 flex-1 space-y-2 rounded-lg border border-dashed p-2 transition-colors",
          id === "BLOCKED" && "border-destructive/30",
          isOver && "border-ring bg-accent/40",
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} todayKey={todayKey} onOpen={onOpenTask} />
          ))}
        </SortableContext>
      </div>
      {footer}
    </div>
  );
}
