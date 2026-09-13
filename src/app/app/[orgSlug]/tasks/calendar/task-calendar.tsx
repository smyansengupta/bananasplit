"use client";

import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, { Draggable } from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { OrgMemberOption } from "@/components/tasks/assignee-picker";
import type { LabelOption } from "@/components/tasks/label-picker";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { toDateInputValue } from "@/components/tasks/utils";

import { updateTask } from "../actions";
import type { TaskWithRelations } from "../queries";

export function TaskCalendar({
  orgId,
  tasks,
  members,
  labels,
  projects,
}: {
  orgId: string;
  tasks: TaskWithRelations[];
  members: OrgMemberOption[];
  labels: LabelOption[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Store only the id and derive the task from the live `tasks` prop, so
  // edits made while the dialog is open (e.g. toggling a subtask) show up
  // immediately after the router.refresh() that follows them.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const editingTask = editingTaskId ? (tasks.find((t) => t.id === editingTaskId) ?? null) : null;

  const datedTasks = tasks.filter((t) => t.dueDate);
  const undatedTasks = tasks.filter((t) => !t.dueDate);

  useEffect(() => {
    if (!sidebarRef.current) return;
    // No eventData/create here on purpose: with create:false FullCalendar
    // never fires eventReceive (it only fires once it's actually added an
    // event to its store). `drop` fires for any external drop regardless,
    // and reading the task id straight off the dragged element is simpler
    // than round-tripping it through eventData anyway.
    const draggable = new Draggable(sidebarRef.current, {
      itemSelector: ".draggable-task",
    });
    return () => draggable.destroy();
  }, []);

  function openTask(taskId: string) {
    setEditingTaskId(taskId);
    setDialogOpen(true);
  }

  return (
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
          events={datedTasks.map((t) => ({
            id: t.id,
            title: t.title,
            start: toDateInputValue(t.dueDate!),
            allDay: true,
            classNames: t.status === "COMPLETED" ? ["opacity-60", "line-through"] : [],
          }))}
          eventClick={(info) => openTask(info.event.id)}
          eventDrop={(info) => {
            const dateStr = info.event.startStr;
            updateTask(orgId, info.event.id, { dueDate: dateStr }).then((result) => {
              if (result?.error) {
                info.revert();
              } else {
                router.refresh();
              }
            });
          }}
          drop={(info) => {
            const taskId = info.draggedEl.dataset.taskId;
            if (!taskId) return;
            updateTask(orgId, taskId, { dueDate: info.dateStr }).then((result) => {
              if (!result?.error) {
                router.refresh();
              }
            });
          }}
        />
      </div>

      <div className="w-full shrink-0 space-y-2 lg:w-64">
        <h2 className="text-sm font-medium">Undated tasks</h2>
        <p className="text-muted-foreground text-xs">Drag onto a day to set a due date.</p>
        <div ref={sidebarRef} className="space-y-2">
          {undatedTasks.length === 0 && (
            <p className="text-muted-foreground text-sm">Nothing undated.</p>
          )}
          {undatedTasks.map((t) => (
            <button
              key={t.id}
              type="button"
              data-task-id={t.id}
              onClick={() => openTask(t.id)}
              className="draggable-task bg-card hover:bg-accent/50 w-full cursor-grab rounded-md border p-2 text-left text-sm active:cursor-grabbing"
            >
              {t.title}
            </button>
          ))}
        </div>
      </div>

      <TaskDetailDialog
        orgId={orgId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        members={members}
        labels={labels}
        projects={projects}
      />
    </div>
  );
}
