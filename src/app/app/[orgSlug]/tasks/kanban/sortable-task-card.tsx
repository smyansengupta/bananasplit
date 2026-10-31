"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useOptimistic, useTransition } from "react";

import { useCompleteTask } from "@/components/tasks/quick-controls";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskCheck } from "@/components/tasks/task-check";
import { TaskItemMenu } from "@/components/tasks/task-item-menu";
import { accessSubjectOf, useTasks } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { TaskStatus } from "@/generated/prisma/enums";
import { canEditTask } from "@/lib/tasks/access";

/**
 * A card on the board. While it is being dragged its place in the column
 * shows as a hatched slot (the lifted copy rides in the DragOverlay). Done
 * cards carry the filled circle, which reopens them.
 */
export function SortableTaskCard({
  task,
  todayKey,
  onOpen,
  showEpic = true,
}: {
  task: TaskItem;
  todayKey: string;
  onOpen: (taskId: string) => void;
  showEpic?: boolean;
}) {
  const { actor } = useTasks();
  const editable = canEditTask(actor, accessSubjectOf(task));
  const complete = useCompleteTask();
  const [status, setOptimistic] = useOptimistic(task.status);
  const [, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  const done = status === TaskStatus.COMPLETED;

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="group focus-visible:outline-foreground rounded-tile relative cursor-grab focus-visible:outline-2 focus-visible:outline-offset-2 active:cursor-grabbing"
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        // Space picks the card up (dnd-kit); Enter opens it, like a button.
        if (e.key === "Enter") onOpen(task.id);
      }}
      {...attributes}
      {...listeners}
      // Read as the task's title, not every word on the card.
      aria-label={task.title}
    >
      {isDragging ? (
        <div
          aria-hidden="true"
          className="bg-muted hatch text-muted-foreground rounded-tile grid min-h-[70px] place-items-center border-[1.5px] border-dashed text-[13px] font-medium"
        >
          Drop here
        </div>
      ) : (
        <>
          <TaskCard
            task={{ ...task, status }}
            todayKey={todayKey}
            showEpic={showEpic}
            check={
              done ? (
                <TaskCheck
                  done
                  disabled={!editable}
                  label={`Reopen ${task.title}`}
                  onToggle={() =>
                    startTransition(async () => {
                      setOptimistic(TaskStatus.NOT_STARTED);
                      await complete(task, TaskStatus.NOT_STARTED);
                    })
                  }
                />
              ) : undefined
            }
          />
          {/* The menu keeps its own clicks and drags (ItemMenu stops them). */}
          <TaskItemMenu
            task={{ id: task.id, title: task.title, subtaskCount: task.subtasks.length }}
            editable={editable}
            onOpen={() => onOpen(task.id)}
            className="bg-card absolute top-2.5 right-2.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
          />
        </>
      )}
    </div>
  );
}
