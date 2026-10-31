"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useBlockedReason } from "@/components/tasks/prompts";
import { TaskCard } from "@/components/tasks/task-card";
import { ProgressBar, TaskTypeChip } from "@/components/tasks/task-type";
import { useTasks } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { TaskStatus } from "@/generated/prisma/enums";
import { STATUS_ORDER, statusTransitionData } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

import { reorderTask, updateTask } from "../actions";
import { KanbanColumn } from "./kanban-column";

const COLUMNS: { status: TaskStatus; title: string }[] = [
  { status: TaskStatus.NOT_STARTED, title: "Not started" },
  { status: TaskStatus.IN_PROGRESS, title: "In progress" },
  { status: TaskStatus.BLOCKED, title: "Blocked" },
  { status: TaskStatus.COMPLETED, title: "Completed" },
];
const STATUSES = new Set<string>(STATUS_ORDER);
const NO_EPIC = "none";

/** The epic a card sits in (its parent, when that is an epic). */
function laneOf(task: TaskItem): string {
  return task.parentTask?.type === "EPIC" ? task.parentTask.id : NO_EPIC;
}

/** "lane:STATUS" in swimlanes, "STATUS" without. */
function parseDropId(id: string): { lane: string | null; status: TaskStatus } | null {
  const [a, b] = id.includes(":") ? id.split(":") : [null, id];
  return b && STATUSES.has(b) ? { lane: a, status: b as TaskStatus } : null;
}

/**
 * Where a dragged card is over: what's under the pointer (a card there, for
 * its place in the order, else the column), never the dragged card's own
 * placeholder, falling back to the biggest overlap when the pointer is in a
 * gap. closestCorners measured corner distances, so a short or empty target
 * column usually lost to a card back in the source column and the card
 * snapped home.
 */
const boardCollision: CollisionDetection = (args) => {
  const droppableContainers = args.droppableContainers.filter((c) => c.id !== args.active.id);
  const within = pointerWithin({ ...args, droppableContainers });
  if (within.length > 0) {
    const card = within.find((c) => parseDropId(String(c.id)) === null);
    return card ? [card] : within;
  }
  return rectIntersection({ ...args, droppableContainers });
};

/**
 * The kanban board (react-query holds the optimistic order). Cards are the
 * club's stories and tasks; with swimlanes on (?lanes=epic) each epic gets a
 * row of its own, and dragging a card into another lane moves it into that
 * epic. Dragging into Blocked asks what it's blocked on; a refused or failed
 * move rolls back. Completed shows the last 14 days.
 */
export function KanbanBoard({
  initialTasks,
  queryKey,
  olderCompleted,
  showAll,
  todayKey,
  lanes = false,
}: {
  initialTasks: TaskItem[];
  queryKey: readonly unknown[];
  olderCompleted: number;
  showAll: boolean;
  todayKey: string;
  lanes?: boolean;
}) {
  const { org, announce, showTask, openTask, newTask } = useTasks();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  function setParam(name: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // The lanes: every epic with a card on the board, then "No epic".
  const laneList = useMemo(() => {
    const seen = new Map<string, { id: string; title: string; tasks: TaskItem[] }>();
    for (const t of tasks) {
      const key = laneOf(t);
      if (key === NO_EPIC) continue;
      const lane = seen.get(key) ?? { id: key, title: t.parentTask!.title, tasks: [] };
      lane.tasks.push(t);
      seen.set(key, lane);
    }
    return [
      ...[...seen.values()].sort((a, b) => a.title.localeCompare(b.title)),
      { id: NO_EPIC, title: "No epic", tasks: tasks.filter((t) => laneOf(t) === NO_EPIC) },
    ];
  }, [tasks]);
  const hasEpics = laneList.length > 1;
  const showLanes = lanes && hasEpics;

  const columnTasks = (status: TaskStatus, lane: string | null) =>
    tasks.filter((t) => t.status === status && (lane === null || laneOf(t) === lane));

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
    let targetLane: string | null = showLanes ? laneOf(dragged) : null;
    let overTaskId: string | null = null;
    const drop = parseDropId(overId);
    if (drop) {
      targetStatus = drop.status;
      if (showLanes && drop.lane) targetLane = drop.lane;
    } else {
      const overTask = tasks.find((t) => t.id === overId);
      if (!overTask) return;
      targetStatus = overTask.status;
      overTaskId = overTask.id;
      if (showLanes) targetLane = laneOf(overTask);
    }

    const targetColumnTasks = columnTasks(targetStatus, targetLane).filter(
      (t) => t.id !== activeId,
    );
    let insertIndex = targetColumnTasks.length;
    if (overTaskId) {
      const idx = targetColumnTasks.findIndex((t) => t.id === overTaskId);
      if (idx !== -1) insertIndex = idx;
    }
    const beforeTask = insertIndex > 0 ? targetColumnTasks[insertIndex - 1] : null;
    const afterTask =
      insertIndex < targetColumnTasks.length ? targetColumnTasks[insertIndex] : null;
    const movesLane = showLanes && targetLane !== null && targetLane !== laneOf(dragged);
    if (!movesLane && dragged.status === targetStatus && beforeTask?.id === dragged.id) return;

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
      let moved: TaskItem =
        dragged.status === targetStatus
          ? dragged
          : { ...dragged, ...statusTransitionData(dragged, targetStatus, { blockedReason }) };
      if (movesLane) {
        const lane = laneList.find((l) => l.id === targetLane);
        moved = {
          ...moved,
          parentTaskId: targetLane === NO_EPIC ? null : targetLane,
          parentTask:
            targetLane === NO_EPIC || !lane
              ? null
              : {
                  id: lane.id,
                  title: lane.title,
                  type: "EPIC",
                  color: "color" in lane ? ((lane.color as string | null) ?? null) : null,
                  parentTask: null,
                },
        };
      }
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
      if (movesLane) {
        // Into another epic's lane: move it into that epic (or out of any).
        const moved = await updateTask(org.id, activeId, {
          parentTaskId: targetLane === NO_EPIC ? null : targetLane,
        });
        if (moved.error) return rollback(moved.error);
      }
      const result = await reorderTask(org.id, input);
      if (result.error) rollback(result.error);
    } catch {
      rollback("That move didn't save. Try again.");
    }
  }

  const olderFooter =
    !showAll && olderCompleted > 0 ? (
      <button
        type="button"
        onClick={() => setParam("done", "all")}
        className="text-muted-foreground hover:text-foreground block w-full rounded-full px-2 py-1 text-left text-xs underline-offset-4 hover:underline"
      >
        Show {olderCompleted} older completed
      </button>
    ) : null;

  const open = (taskId: string) => {
    const found = tasks.find((t) => t.id === taskId);
    if (found) showTask(found);
  };

  return (
    <>
      {blockedPrompt}
      <DndContext
        // A fixed id: dnd-kit's own counter differs between the server and
        // the browser, which broke hydration (aria-describedby).
        id="tasks-kanban"
        sensors={sensors}
        collisionDetection={boardCollision}
        onDragStart={handleDragStart}
        onDragEnd={(e) => void handleDragEnd(e)}
        onDragCancel={() => setActiveTask(null)}
      >
        {showLanes ? (
          <div className="space-y-[30px]">
            {laneList.map((lane) => {
              const epicTask = lane.id === NO_EPIC ? null : lane;
              const doneCount = lane.tasks.filter((t) => t.status === "COMPLETED").length;
              return (
                <section key={lane.id} aria-label={epicTask ? `Epic: ${lane.title}` : "No epic"}>
                  <div className="mb-2.5 flex items-center gap-3 px-1">
                    {epicTask ? (
                      <>
                        <TaskTypeChip type="EPIC" />
                        <button
                          type="button"
                          onClick={() => openTask(lane.id)}
                          className="heading truncate underline-offset-4 hover:underline"
                        >
                          {lane.title}
                        </button>
                        <ProgressBar
                          done={doneCount}
                          total={lane.tasks.length}
                          color="var(--chart-4)"
                          className="w-32"
                        />
                      </>
                    ) : (
                      <h2 className="heading text-muted-foreground">No epic</h2>
                    )}
                  </div>
                  <div className="-mx-1 flex gap-3.5 overflow-x-auto px-1 pb-2 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
                    {COLUMNS.map((col) => (
                      <KanbanColumn
                        key={col.status}
                        id={`${lane.id}:${col.status}`}
                        status={col.status}
                        title={col.title}
                        tasks={columnTasks(col.status, lane.id)}
                        todayKey={todayKey}
                        showEpic={false}
                        onOpenTask={open}
                        onAddTask={() =>
                          newTask({
                            status: col.status,
                            ...(epicTask
                              ? { parentTaskId: lane.id, parentType: "EPIC" as const }
                              : {}),
                          })
                        }
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="-mx-1 flex gap-3.5 overflow-x-auto px-1 pb-4 lg:mx-0 lg:grid lg:grid-cols-4 lg:overflow-visible lg:px-0">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.status}
                id={col.status}
                status={col.status}
                title={col.title}
                tasks={columnTasks(col.status, null)}
                todayKey={todayKey}
                onOpenTask={open}
                onAddTask={() => newTask({ status: col.status })}
                footer={col.status === TaskStatus.COMPLETED ? olderFooter : null}
              />
            ))}
          </div>
        )}
        <DragOverlay>
          {activeTask && (
            <div className={cn("cursor-grabbing")}>
              <TaskCard task={activeTask} todayKey={todayKey} dragging showEpic={!showLanes} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </>
  );
}
