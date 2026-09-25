"use client";

import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import { Lock } from "lucide-react";
import { useEffect, useRef } from "react";

import { isTaskPrivate } from "@/components/tasks/task-badges";
import { useTasks } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { dueDateKey } from "@/lib/tasks/dates";

import { updateTask } from "../actions";

/**
 * Calendar of due dates (floating dates), subtasks included, with an owner
 * filter. Drag an event to move its due date; drag an undated task onto a
 * day to give it one.
 */
export function TaskCalendar({ tasks }: { tasks: TaskItem[] }) {
  const { org, announce, showTask } = useTasks();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const open = (taskId: string) => {
    const found = byId.get(taskId);
    if (found) showTask(found);
  };

  const dated = tasks.filter((t) => t.dueDate);
  const undated = tasks.filter((t) => !t.dueDate && t.status !== "COMPLETED");

  useEffect(() => {
    if (!sidebarRef.current) return;
    // With create:false FullCalendar never fires eventReceive; `drop` fires
    // for any external drop and the task id is read off the dragged element.
    const draggable = new Draggable(sidebarRef.current, { itemSelector: ".draggable-task" });
    return () => draggable.destroy();
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <FullCalendar
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{
              left: "prev,next today",
              center: "title",
              right: "dayGridMonth,dayGridWeek",
            }}
            height="auto"
            editable
            droppable
            events={dated.map((t) => ({
              id: t.id,
              title: `${isTaskPrivate(t) ? "🔒 " : ""}${t.parentTask ? `${t.parentTask.title} / ` : ""}${t.title}${t.owner?.name ? ` · ${t.owner.name.split(" ")[0]}` : ""}`,
              start: dueDateKey(t.dueDate!),
              allDay: true,
              classNames: [
                ...(t.status === "COMPLETED" ? ["opacity-60", "line-through"] : []),
                ...(t.status === "BLOCKED" ? ["bg-destructive!", "border-destructive!"] : []),
              ],
            }))}
            eventClick={(info) => open(info.event.id)}
            eventDrop={(info) => {
              updateTask(org.id, info.event.id, { dueDate: info.event.startStr.slice(0, 10) })
                .then((result) => {
                  if (result.error) {
                    info.revert();
                    announce(result.error);
                  }
                })
                .catch(() => info.revert());
            }}
            drop={(info) => {
              const taskId = info.draggedEl.dataset.taskId;
              if (!taskId) return;
              updateTask(org.id, taskId, { dueDate: info.dateStr.slice(0, 10) }).then((result) => {
                if (result.error) announce(result.error);
              });
            }}
          />
        </div>

        <div className="w-full shrink-0 space-y-2 lg:w-64">
          <h2 className="text-sm font-medium">Undated tasks</h2>
          <p className="text-muted-foreground text-xs">Drag onto a day to set a due date.</p>
          <div ref={sidebarRef} className="space-y-2">
            {undated.length === 0 && (
              <p className="text-muted-foreground text-sm">Nothing undated.</p>
            )}
            {undated.map((t) => (
              <button
                key={t.id}
                type="button"
                data-task-id={t.id}
                onClick={() => open(t.id)}
                className={`draggable-task bg-card hover:bg-accent/50 w-full cursor-grab rounded-md border p-2 text-left text-sm transition-colors active:cursor-grabbing${isTaskPrivate(t) ? "border-dashed" : ""}`}
              >
                {isTaskPrivate(t) && (
                  <Lock
                    className="text-muted-foreground me-1 inline size-3 align-[-1px]"
                    aria-label="Private"
                  />
                )}
                {t.parentTask && (
                  <span className="text-muted-foreground">{t.parentTask.title} / </span>
                )}
                {t.title}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
