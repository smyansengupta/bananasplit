"use client";

import { CheckSquare, Loader2, Plus } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addLinkAction } from "@/app/app/[orgSlug]/links/actions";
import { createTask, setTaskStatus } from "@/app/app/[orgSlug]/tasks/actions";
import { TaskCheck } from "@/components/tasks/task-check";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast, undoable } from "@/components/ui/toaster";
import type { TaskStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export interface MeetingTask {
  id: string;
  title: string;
  status: TaskStatus;
  /** "Priya, Nov 12": who has it and when it's due, as words. */
  meta: string | null;
}

/**
 * Tasks from this meeting: the tasks linked to it (ItemLink, the same links
 * the Linked panel shows), each with its done circle, and a line to add one
 * that's made and linked to the meeting in one go. What a meeting decided
 * stays with the meeting.
 */
export function MeetingTasks({
  orgId,
  orgSlug,
  eventId,
  initial,
  ambient = null,
}: {
  orgId: string;
  orgSlug: string;
  eventId: string;
  initial: MeetingTask[];
  /** From its notes and while it's on (components/meetings/meeting-ambient). */
  ambient?: React.ReactNode;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();

  function add() {
    const text = title.trim();
    if (!text || pending) return;
    start(async () => {
      const made = (await createTask(orgId, { title: text })) as {
        error?: string;
        taskId?: string;
      };
      if (made.error || !made.taskId) {
        toast({ title: made.error ?? "The task couldn't be made.", tone: "error" });
        return;
      }
      const linked = await addLinkAction(
        orgId,
        orgSlug,
        { kind: "event", id: eventId },
        { kind: "task", id: made.taskId },
      );
      if (linked.error) toast({ title: linked.error, tone: "error" });
      setTasks((list) => [
        ...list,
        { id: made.taskId!, title: text, status: "NOT_STARTED", meta: null },
      ]);
      setTitle("");
      router.refresh();
    });
  }

  function toggle(task: MeetingTask) {
    const next: TaskStatus = task.status === "COMPLETED" ? "NOT_STARTED" : "COMPLETED";
    const set = (status: TaskStatus) =>
      setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, status } : t)));
    set(next);
    void undoable({
      title: next === "COMPLETED" ? "Done" : "Reopened",
      run: async () => {
        const result = await setTaskStatus(orgId, task.id, next);
        if (result.error) {
          set(task.status);
          return result.error;
        }
      },
      undo: async () => {
        const back = await setTaskStatus(orgId, task.id, task.status);
        if (back.error) return back.error;
        set(task.status);
      },
    });
  }

  const open = tasks.filter((t) => t.status !== "COMPLETED").length;

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <CardTitle>Tasks from this meeting</CardTitle>
        {tasks.length > 0 && <Badge variant="secondary">{open}</Badge>}
      </CardHeader>
      <CardContent className="space-y-2">
        {ambient && <div className="pb-1">{ambient}</div>}
        {tasks.length > 0 && (
          <ul className="-mx-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="hover:bg-muted/60 rounded-field flex items-center gap-3 px-2 py-2"
              >
                <TaskCheck
                  done={t.status === "COMPLETED"}
                  onToggle={() => toggle(t)}
                  label={t.status === "COMPLETED" ? `Reopen ${t.title}` : `Complete ${t.title}`}
                />
                <Link
                  href={`/app/${orgSlug}/tasks/${t.id}`}
                  className={cn(
                    "min-w-0 flex-1 text-sm font-medium break-words underline-offset-4 hover:underline",
                    t.status === "COMPLETED" && "text-muted-foreground line-through",
                  )}
                >
                  {t.title}
                </Link>
                {t.meta && (
                  <span className="text-muted-foreground shrink-0 text-[12.5px]">{t.meta}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
          className="bg-muted/50 focus-within:outline-foreground flex h-10 items-center gap-2 rounded-full ps-3.5 pe-1.5 focus-within:outline-2 focus-within:outline-offset-2"
        >
          <CheckSquare className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a task"
            aria-label="Add a task from this meeting"
            maxLength={200}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
          <button
            type="submit"
            disabled={!title.trim() || pending}
            aria-label="Add task"
            className="text-muted-foreground hover:text-foreground hover:bg-muted grid size-7 place-items-center rounded-full disabled:opacity-40"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="size-4" aria-hidden="true" />
            )}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
