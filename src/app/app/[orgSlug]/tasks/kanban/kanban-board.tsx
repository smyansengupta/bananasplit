"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useBlockedReason } from "@/components/tasks/prompts";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { useTasks } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { TaskStatus } from "@/generated/prisma/enums";
import { STATUS_ORDER, statusTransitionData } from "@/lib/tasks/status";

import { reorderTask } from "../actions";
import { KanbanColumn } from "./kanban-column";

const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: TaskStatus.NOT_STARTED, title: "Not started" },
  { status: TaskStatus.IN_PROGRESS, title: "In progress" },
  { status: TaskStatus.BLOCKED, title: "Blocked" },
  { status: TaskStatus.COMPLETED, title: "Completed" },
];
const COLUMN_IDS = new Set<string>(STATUS_ORDER);

/**
 * The kanban board (react-query holds the optimistic order). Dragging into
 * Blocked asks what it's blocked on; a refused or failed move rolls back.
 * Completed shows the last 14 days, with a link to show older ones.
 */
export function KanbanBoard({
  initialTasks,
  queryKey,
  olderCompleted,
  showAllHref,
}: {
  initialTasks: TaskItem[];
  queryKey: readonly unknown[];
  olderCompleted: number;
  showAllHref: string | null;
}) {
  const { org, announce } = useTasks();
  const queryClient = useQueryClient();
  const [blockedPrompt, askReason] = useBlockedReason();
  const { data: tasks = initialTasks } = useQuery({
    queryKey,
    queryFn: () => Promise.resolve(initialTasks),
    initialData: initialTasks,
    staleTime: Infinity,
  });

  // initialData only seeds the cache once; every later server render (after
  // refresh() in an action) hands us new initialTasks, synced in here.
  useEffect(() => {
    queryClient.setQueryData(queryKey, initialTasks);
  }, [initialTasks, queryClient, queryKey]);

  const [activeTask, setActiveTask] = useState<TaskItem | null>(null);
  const [detail, setDetail] = useState<{ open: boolean; taskId: string | null; defaultStatus?: TaskStatus }>({
    open: false,
    taskId: null,
  });
  const detailTask = detail.taskId ? (tasks.find((t) => t.id === detail.taskId) ?? null) : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = useMemo(() => {
    const grouped: Record<TaskStatus, TaskItem[]> = {
      NOT_STARTED: [],
      IN_PROGRESS: [],
      BLOCKED: [],
      COMPLETED: [],
    };
    for (const task of tasks) grouped[task.status].push(task);
    return grouped;
  }, [tasks]);

  function handleDragStart(event: DragStartEvent) {
    setActiveTask(tasks.find((t) => t.id === event.active.id) ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const dragged = tasks.find((t) => t.id === activeId);
    if (!dragged) return;

    const overId = String(over.id);
    let targetStatus: TaskStatus;
    let overTaskId: string | null = null;
    if (COLUMN_IDS.has(overId)) {
      targetStatus = overId as TaskStatus;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
      overTaskId = overTask.id;
    }

    const targetColumnTasks = columns[targetStatus].filter((t) => t.id !== activeId);
    let insertIndex = targetColumnTasks.length;
    if (overTaskId) {
      const idx = targetColumnTasks.findIndex((t) => t.id === overTaskId);
      if (idx !== -1) insertIndex = idx;
    }
    const beforeTask = insertIndex > 0 ? targetColumnTasks[insertIndex - 1] : null;
    const afterTask = insertIndex < targetColumnTasks.length ? targetColumnTasks[insertIndex] : null;
    if (dragged.status === targetStatus && beforeTask?.id === dragged.id) return;

    let blockedReason: string | null = null;
    if (targetStatus === TaskStatus.BLOCKED && dragged.status !== TaskStatus.BLOCKED) {
      blockedReason = await askReason(dragged.title);
      if (!blockedReason) return;
    }

    const input = {
      taskId: activeId,
      status: targetStatus,
      beforeId: beforeTask?.id ?? null,
      afterId: afterTask?.id ?? null,
      blockedReason,
    };

    const previous = queryClient.getQueryData<TaskItem[]>(queryKey);
    queryClient.setQueryData<TaskItem[]>(queryKey, (old = []) => {
      const withoutActive = old.filter((t) => t.id !== activeId);
      const moved: TaskItem =
        dragged.status === targetStatus
          ? dragged
          : { ...dragged, ...statusTransitionData(dragged, targetStatus, { blockedReason }) };
      let insertAt: number;
      if (input.beforeId) {
        const idx = withoutActive.findIndex((t) => t.id === input.beforeId);
        insertAt = idx === -1 ? withoutActive.length : idx + 1;
      } else if (input.afterId) {
        const idx = withoutActive.findIndex((t) => t.id === input.afterId);
        insertAt = idx === -1 ? withoutActive.length : idx;
      } else {
        const targetOrder = STATUS_ORDER.indexOf(targetStatus);
        insertAt = withoutActive.findIndex((t) => STATUS_ORDER.indexOf(t.status) > targetOrder);
        if (insertAt === -1) insertAt = withoutActive.length;
      }
      const next = withoutActive.slice();
      next.splice(insertAt, 0, moved);
      return next;
    });

    const rollback = (message: string) => {
      if (previous) queryClient.setQueryData(queryKey, previous);
      announce(message);
    };
    try {
      const result = await reorderTask(org.id, input);
      if (result.error) rollback(result.error);
    } catch {
      rollback("That move didn't save. Try again.");
    }
  }

  return (
    <>
      {blockedPrompt}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={(e) => void handleDragEnd(e)}
        onDragCancel={() => setActiveTask(null)}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.status}
              id={col.status}
              title={col.title}
              tasks={columns[col.status]}
              todayKey={org.todayKey}
              onOpenTask={(taskId) => setDetail({ open: true, taskId })}
              onAddTask={() => setDetail({ open: true, taskId: null, defaultStatus: col.status })}
              footer={
                col.status === TaskStatus.COMPLETED && showAllHref && olderCompleted > 0 ? (
                  <Link href={showAllHref} className="text-muted-foreground hover:text-foreground block px-1 text-xs">
                    Show {olderCompleted} older completed
                  </Link>
                ) : null
              }
            />
          ))}
        </div>
        <DragOverlay>{activeTask && <TaskCard task={activeTask} todayKey={org.todayKey} />}</DragOverlay>
      </DndContext>

      <TaskDetailDialog
        open={detail.open}
        onOpenChange={(open) => setDetail((s) => ({ ...s, open }))}
        task={detailTask}
        defaults={{ status: detail.defaultStatus }}
      />
    </>
  );
}
