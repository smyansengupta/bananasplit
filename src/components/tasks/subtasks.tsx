"use client";

import { ChevronRight } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";

import { createTask, setTaskStatus } from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { TaskStatus } from "@/generated/prisma/enums";
import { relationFor } from "@/lib/tasks/assignment";
import { cn } from "@/lib/utils";

import { OwnerPicker } from "./member-picker";
import { useConfirmFlagged } from "./prompts";
import { DueLabel } from "./task-badges";
import { useTasks } from "./tasks-context";
import type { SubtaskItem } from "./types";

/**
 * Subtasks: a lead breaks a task into pieces for others. Each row toggles
 * done optimistically; the add row takes a title, an inline owner and a due
 * date, and hands down through the same checked path as any assignment.
 */

export function Subtasks({
  parentId,
  subtasks,
  canAdd,
  onOpen,
}: {
  parentId: string;
  subtasks: SubtaskItem[];
  canAdd: boolean;
  onOpen?: (subtaskId: string) => void;
}) {
  const { org, viewer, memberById, announce } = useTasks();
  const [items, setOptimistic] = useOptimistic(
    subtasks,
    (state: SubtaskItem[], change: { id: string; status: TaskStatus }) =>
      state.map((s) => (s.id === change.id ? { ...s, status: change.status } : s)),
  );
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmElement, confirmFlagged] = useConfirmFlagged();

  const done = items.filter((s) => s.status === TaskStatus.COMPLETED).length;

  function toggle(s: SubtaskItem) {
    const next = s.status === TaskStatus.COMPLETED ? TaskStatus.NOT_STARTED : TaskStatus.COMPLETED;
    startTransition(async () => {
      setOptimistic({ id: s.id, status: next });
      const result = await setTaskStatus(org.id, s.id, next);
      if (result.error) announce(result.error);
    });
  }

  async function add() {
    const text = title.trim();
    if (!text) return;
    setError(null);
    let confirmed = false;
    if (ownerId && relationFor(viewer.chart, ownerId) === "ABOVE") {
      confirmed = await confirmFlagged([memberById.get(ownerId)?.name ?? "This person"]);
      if (!confirmed) return;
    }
    startTransition(async () => {
      const input = { title: text, parentTaskId: parentId, ownerId, dueDate: dueDate || null, confirmFlagged: confirmed };
      let result = await createTask(org.id, input);
      if ("confirm" in result && result.confirm) {
        const ok = await confirmFlagged(result.confirm.flagged.map((f) => f.name ?? "Someone"));
        if (!ok) return;
        result = await createTask(org.id, { ...input, confirmFlagged: true });
      }
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      setOwnerId(null);
      setDueDate("");
    });
  }

  return (
    <section className="space-y-2" aria-label="Subtasks">
      {confirmElement}
      <h3 className="text-sm font-medium">
        Subtasks
        {items.length > 0 && (
          <span className="text-muted-foreground ml-1 font-normal">
            ({done}/{items.length} done)
          </span>
        )}
      </h3>
      {items.length > 0 && (
        <ul className="divide-y rounded-md border">
          {items.map((s) => {
            const owner = s.ownerId ? (memberById.get(s.ownerId) ?? s.owner) : null;
            const isDone = s.status === TaskStatus.COMPLETED;
            return (
              <li key={s.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <Checkbox
                  checked={isDone}
                  onCheckedChange={() => toggle(s)}
                  aria-label={isDone ? `Reopen ${s.title}` : `Complete ${s.title}`}
                />
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 truncate text-left hover:underline",
                    isDone && "text-muted-foreground line-through",
                  )}
                  onClick={() => onOpen?.(s.id)}
                >
                  {s.title}
                </button>
                {s.status === TaskStatus.BLOCKED && <span className="text-destructive text-xs">Blocked</span>}
                <DueLabel dueDate={s.dueDate} todayKey={org.todayKey} done={isDone} className="text-muted-foreground text-xs" />
                {owner ? (
                  <UserAvatar user={owner} size="xs" />
                ) : (
                  <span className="text-muted-foreground text-xs">No owner</span>
                )}
                {onOpen && <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
      {canAdd && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="New subtask"
            placeholder="Add a subtask…"
            value={title}
            className="h-8 min-w-40 flex-1"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
          />
          <OwnerPicker value={ownerId} onChange={setOwnerId} compact />
          <Input
            type="date"
            aria-label="Subtask due date"
            value={dueDate}
            className="h-8 w-36"
            onChange={(e) => setDueDate(e.target.value)}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => void add()} disabled={isPending || !title.trim()}>
            Add
          </Button>
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}
