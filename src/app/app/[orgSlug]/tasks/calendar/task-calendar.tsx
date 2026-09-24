"use client";

import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { useTasks } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dueDateKey } from "@/lib/tasks/dates";

import { updateTask } from "../actions";

/**
 * Calendar of due dates (floating dates), subtasks included, with an owner
 * filter. Drag an event to move its due date; drag an undated task onto a
 * day to give it one.
 */
export function TaskCalendar({ tasks }: { tasks: TaskItem[] }) {
  const { org, members, announce } = useTasks();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const openTask = openTaskId ? (tasks.find((t) => t.id === openTaskId) ?? null) : null;

  const dated = tasks.filter((t) => t.dueDate);
  const undated = tasks.filter((t) => !t.dueDate && t.status !== "COMPLETED");

  useEffect(() => {
    if (!sidebarRef.current) return;
    // With create:false FullCalendar never fires eventReceive; `drop` fires
    // for any external drop and the task id is read off the dragged element.
    const draggable = new Draggable(sidebarRef.current, { itemSelector: ".draggable-task" });
    return () => draggable.destroy();
  }, []);

  function setOwner(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("owner");
    else params.set("owner", value);
    router.replace(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <Select value={searchParams.get("owner") ?? "all"} onValueChange={setOwner}>
        <SelectTrigger className="w-48" aria-label="Owner filter">
          <SelectValue placeholder="Owner" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Everyone&apos;s tasks</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name ?? "Member"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <FullCalendar
            plugins={[dayGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,dayGridWeek" }}
            height="auto"
            editable
            droppable
            events={dated.map((t) => ({
              id: t.id,
              title: `${t.parentTask ? `${t.parentTask.title} / ` : ""}${t.title}${t.owner?.name ? ` · ${t.owner.name.split(" ")[0]}` : ""}`,
              start: dueDateKey(t.dueDate!),
              allDay: true,
              classNames: [
                ...(t.status === "COMPLETED" ? ["opacity-60", "line-through"] : []),
                ...(t.status === "BLOCKED" ? ["bg-destructive!", "border-destructive!"] : []),
              ],
            }))}
            eventClick={(info) => setOpenTaskId(info.event.id)}
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
            {undated.length === 0 && <p className="text-muted-foreground text-sm">Nothing undated.</p>}
            {undated.map((t) => (
              <button
                key={t.id}
                type="button"
                data-task-id={t.id}
                onClick={() => setOpenTaskId(t.id)}
                className="draggable-task bg-card hover:bg-accent/50 w-full cursor-grab rounded-md border p-2 text-left text-sm active:cursor-grabbing"
              >
                {t.parentTask && <span className="text-muted-foreground">{t.parentTask.title} / </span>}
                {t.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      <TaskDetailDialog open={openTaskId !== null} onOpenChange={(o) => !o && setOpenTaskId(null)} task={openTask} />
    </div>
  );
}
