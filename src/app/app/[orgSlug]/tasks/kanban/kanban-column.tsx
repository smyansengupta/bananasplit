"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";

import { GroupHeader, STATUS_TOKEN } from "@/components/tasks/layout-ui";
import type { TaskItem } from "@/components/tasks/types";
import { cn } from "@/lib/utils";

import { SortableTaskCard } from "./sortable-task-card";

/**
 * A board column.
 *
 * The column is a filled surface rather than a dashed outline: dashed now
 * means "private" on the cards inside it, and two different dashed edges in
 * one screen cancel each other out. Blocked keeps a tinted header so the
 * column that matters at an exec sync is findable without reading.
 */
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
  tasks: TaskItem[];
  todayKey: string;
  onOpenTask: (taskId: string) => void;
  onAddTask: () => void;
  footer?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const blocked = id === "BLOCKED";

  return (
    <section
      aria-label={`${title}, ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
      className="group/col flex w-[17rem] shrink-0 flex-col gap-2 lg:w-auto lg:min-w-0 lg:flex-1"
    >
      <GroupHeader
        title={title}
        count={tasks.length}
        dot={STATUS_TOKEN[id] ?? "var(--muted-foreground)"}
        tone={blocked ? "danger" : undefined}
      >
        <button
          type="button"
          onClick={onAddTask}
          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring ms-auto rounded p-1 opacity-0 transition-opacity duration-150 group-focus-within/col:opacity-100 group-hover/col:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
          aria-label={`Add a task to ${title}`}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </GroupHeader>

      <div
        ref={setNodeRef}
        data-testid={`kanban-column-${id}`}
        className={cn(
          "bg-muted/50 ring-border min-h-28 flex-1 space-y-2 rounded-xl p-2 ring-1 transition-colors duration-150 ring-inset",
          blocked && "bg-destructive/5 ring-destructive/20",
          isOver && "ring-ring bg-accent/50 ring-2",
        )}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} todayKey={todayKey} onOpen={onOpenTask} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <button
            type="button"
            onClick={onAddTask}
            className="text-muted-foreground hover:text-foreground hover:bg-background/60 flex h-20 w-full items-center justify-center rounded-lg text-xs transition-colors duration-150"
          >
            {blocked ? "Nothing is blocked" : "Drop a task here, or add one"}
          </button>
        )}
      </div>
      {footer}
    </section>
  );
}
