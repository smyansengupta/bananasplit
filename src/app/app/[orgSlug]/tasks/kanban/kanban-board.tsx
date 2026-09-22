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
import { useEffect, useMemo, useState } from "react";

import type { OrgMemberOption } from "@/components/tasks/assignee-picker";
import type { LabelOption } from "@/components/tasks/label-picker";
import { TaskCard } from "@/components/tasks/task-card";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { TaskStatus } from "@/generated/prisma/enums";

import { reorderTask } from "../actions";
import type { TaskWithRelations } from "../queries";
import { KanbanColumn } from "./kanban-column";

const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: TaskStatus.NOT_STARTED, title: "Not started" },
  { status: TaskStatus.IN_PROGRESS, title: "In progress" },
  { status: TaskStatus.BLOCKED, title: "Blocked" },
  { status: TaskStatus.COMPLETED, title: "Completed" },
];
const STATUS_ORDER = COLUMNS.map((c) => c.status);
const COLUMN_IDS = new Set<string>(STATUS_ORDER);

interface Props {
  orgId: string;
  initialTasks: TaskWithRelations[];
  queryKey: readonly unknown[];
  members: OrgMemberOption[];
  labels: LabelOption[];
  projects: { id: string; name: string }[];
}

export function KanbanBoard({ orgId, initialTasks, queryKey, members, labels, projects }: Props) {
  const queryClient = useQueryClient();
  const { data: tasks = initialTasks } = useQuery({
    queryKey,
    queryFn: () => Promise.resolve(initialTasks),
    initialData: initialTasks,
    staleTime: Infinity,
  });

  // initialData only seeds the cache once. Every later Server Component
  // refresh (after a create/edit/delete elsewhere in this dialog) hands us a
  // new initialTasks prop, which this syncs into the query cache — otherwise
  // the board would keep showing pre-refresh data after non-drag edits.
  useEffect(() => {
    queryClient.setQueryData(queryKey, initialTasks);
  }, [initialTasks, queryClient, queryKey]);

  const [activeTask, setActiveTask] = useState<TaskWithRelations | null>(null);
  // Store only the id, not a task snapshot — deriving the task from the live
  // `tasks` array on every render means edits (e.g. toggling a subtask) show
  // up immediately instead of needing the dialog to be closed and reopened.
  const [detailState, setDetailState] = useState<{
    open: boolean;
    taskId: string | null;
    defaultStatus?: TaskStatus;
  }>({ open: false, taskId: null });
  const detailTask = detailState.taskId
    ? (tasks.find((t) => t.id === detailState.taskId) ?? null)
    : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columns = useMemo(() => {
    const grouped: Record<TaskStatus, TaskWithRelations[]> = {
      NOT_STARTED: [],
      IN_PROGRESS: [],
      BLOCKED: [],
      COMPLETED: [],
    };
    for (const task of tasks) {
      grouped[task.status].push(task);
    }
    return grouped;
  }, [tasks]);

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id);
    setActiveTask(task ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
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
    const afterTask =
      insertIndex < targetColumnTasks.length ? targetColumnTasks[insertIndex] : null;

    if (dragged.status === targetStatus && beforeTask?.id === dragged.id) {
      return; // dropped back in the same spot
    }

    const input = {
      taskId: activeId,
      status: targetStatus,
      beforeId: beforeTask?.id ?? null,
      afterId: afterTask?.id ?? null,
    };

    const previous = queryClient.getQueryData<TaskWithRelations[]>(queryKey);
    queryClient.setQueryData<TaskWithRelations[]>(queryKey, (old = []) => {
      const withoutActive = old.filter((t) => t.id !== activeId);
      const moved = { ...dragged, status: targetStatus };

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

    reorderTask(orgId, input).then((result) => {
      if (result?.error && previous) {
        queryClient.setQueryData(queryKey, previous);
      }
    });
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col.status}
              id={col.status}
              title={col.title}
              tasks={columns[col.status]}
              onOpenTask={(taskId) => setDetailState({ open: true, taskId })}
              onAddTask={() =>
                setDetailState({ open: true, taskId: null, defaultStatus: col.status })
              }
            />
          ))}
        </div>
        <DragOverlay>{activeTask && <TaskCard task={activeTask} />}</DragOverlay>
      </DndContext>

      <TaskDetailDialog
        orgId={orgId}
        open={detailState.open}
        onOpenChange={(open) => setDetailState((s) => ({ ...s, open }))}
        task={detailTask}
        defaultStatus={detailState.defaultStatus}
        members={members}
        labels={labels}
        projects={projects}
      />
    </>
  );
}
