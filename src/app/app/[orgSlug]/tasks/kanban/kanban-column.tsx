"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "@/components/icons";
import { useState } from "react";

import { ClearCompletedButton } from "@/components/tasks/clear-completed";
import { QuickAddField } from "@/components/tasks/quick-add-field";
import { STATUS_TOKEN } from "@/components/tasks/layout-ui";
import type { TaskItem } from "@/components/tasks/types";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

import { SortableTaskCard } from "./sortable-task-card";

/**
 * A board column (Moonstone 10.1): a soft rounded-block panel with the
 * status dot and name, a count chip and +. Filled rather than outlined:
 * dashed means "private" on the cards inside it. A column being dragged
 * over lifts its fill a little.
 *
 * + opens a one-line quick add at the top of the column (a whole task from
 * "Order bolts @priya fri"), in this column's status and the epic in view;
 * it stays open for the next line until Esc. Blocked asks why, so its +
 * opens the form instead.
 */
export function KanbanColumn({
  id,
  status,
  title,
  tasks,
  todayKey,
  onOpenTask,
  onAddTask,
  parentTaskId = null,
  footer,
  showEpic = true,
  compact = false,
}: {
  /** The droppable id: the status, or "lane:status" in swimlanes. */
  id: string;
  status: string;
  title: string;
  tasks: TaskItem[];
  todayKey: string;
  onOpenTask: (taskId: string) => void;
  onAddTask: () => void;
  /** The epic new tasks from this column go into (a lane's, or the filter's). */
  parentTaskId?: string | null;
  footer?: React.ReactNode;
  showEpic?: boolean;
  /** In a swimlane: no header (the lane's column heads say it). */
  compact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const blocked = status === "BLOCKED";
  const [adding, setAdding] = useState(false);
  const add = () => (blocked ? onAddTask() : setAdding(true));

  return (
    <section
      // The whole column, header included, takes a drop.
      ref={setNodeRef}
      aria-label={`${title}, ${tasks.length} task${tasks.length === 1 ? "" : "s"}`}
      className={cn(
        "group/col bg-muted/65 rounded-block flex w-[17rem] shrink-0 flex-col gap-2.5 p-2.5 transition-colors duration-150 lg:w-auto lg:min-w-0 lg:flex-1",
        isOver && "bg-muted",
      )}
    >
      {!compact && (
        <div className="flex items-center gap-2 px-1.5 pt-1.5 pb-0.5">
          <StatusDot
            color={STATUS_TOKEN[status] ?? "var(--muted-foreground)"}
            className={cn("text-sm font-semibold", blocked && "text-tint-danger-foreground")}
          >
            {title}
          </StatusDot>
          <Badge variant="secondary" className="tabular-nums">
            {tasks.length}
          </Badge>
          <span className="flex-1" />
          {status === "COMPLETED" && <ClearCompletedButton tasks={tasks} />}
          {status !== "COMPLETED" && (
            <button
              type="button"
              onClick={add}
              aria-expanded={blocked ? undefined : adding}
              className="text-muted-foreground hover:text-foreground hover:bg-card focus-visible:outline-foreground grid size-8 place-items-center rounded-full transition-[background-color,transform] focus-visible:outline-2 active:scale-[0.94]"
              aria-label={`Add a task to ${title}`}
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div data-testid={`kanban-column-${id}`} className="flex min-h-24 flex-1 flex-col gap-2.5">
        {adding && (
          <QuickAddField
            compact
            autoFocus
            defaults={{ status: status as TaskItem["status"], parentTaskId }}
            placeholder="Title, @owner, date"
            onEscape={() => setAdding(false)}
          />
        )}
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              todayKey={todayKey}
              onOpen={onOpenTask}
              showEpic={showEpic}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && !adding && (
          <button
            type="button"
            onClick={add}
            className={cn(
              "text-muted-foreground hover:text-foreground rounded-tile flex h-[70px] w-full items-center justify-center border-[1.5px] border-dashed text-[13px] font-medium transition-colors duration-150",
              isOver && "bg-muted hatch",
            )}
          >
            {isOver ? "Drop here" : blocked ? "None" : "Add task"}
          </button>
        )}
      </div>
      {footer}
    </section>
  );
}
