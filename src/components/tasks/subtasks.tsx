"use client";

import { ChevronRight } from "@/components/icons";
import { useOptimistic, useState, useTransition } from "react";

import { createTask } from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { UserAvatar } from "@/components/user-avatar";
import { TaskStatus } from "@/generated/prisma/enums";
import { relationFor } from "@/lib/tasks/assignment";
import { rollUp, type TaskTypeValue } from "@/lib/tasks/hierarchy";
import { cn } from "@/lib/utils";

import { OwnerPicker } from "./member-picker";
import { useConfirmFlagged } from "./prompts";
import { useCompleteTask } from "./quick-controls";
import { DueLabel } from "./task-badges";
import { TaskCheck } from "./task-check";
import { ProgressBar, TaskTypeChip } from "./task-type";
import { TaskTitle } from "./task-title";
import { useTasks } from "./tasks-context";
import type { SubtaskItem } from "./types";

/**
 * What a task breaks into. An epic holds stories and tasks (its progress
 * rolls up through its stories' tasks); a story, or a plain task being
 * broken down (which makes it a story), holds tasks. Each row completes with
 * the circle; the add row takes a title, an inline owner and a due date, and
 * hands down through the same checked path as any assignment.
 */
export function Subtasks({
  parentId,
  parentType,
  subtasks,
  canAdd,
  onOpen,
  projectColor = "var(--tag-navy)",
}: {
  parentId: string;
  parentType: TaskTypeValue;
  subtasks: SubtaskItem[];
  canAdd: boolean;
  onOpen?: (subtaskId: string) => void;
  /** The bar's colour: the parent's project. */
  projectColor?: string;
}) {
  const { org, viewer, memberById } = useTasks();
  const complete = useCompleteTask();
  const [items, setOptimistic] = useOptimistic(
    subtasks,
    (state: SubtaskItem[], change: { id: string; status: TaskStatus }) =>
      state.map((s) => (s.id === change.id ? { ...s, status: change.status } : s)),
  );
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [childType, setChildType] = useState<"TASK" | "STORY">("TASK");
  const [error, setError] = useState<string | null>(null);
  const [confirmElement, confirmFlagged] = useConfirmFlagged();
  const epic = parentType === "EPIC";
  const progress = rollUp(items);

  function toggle(s: SubtaskItem) {
    const next = s.status === TaskStatus.COMPLETED ? TaskStatus.NOT_STARTED : TaskStatus.COMPLETED;
    startTransition(async () => {
      setOptimistic({ id: s.id, status: next });
      await complete(s, next);
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
      const input = {
        title: text,
        parentTaskId: parentId,
        ...(epic ? { type: childType } : {}),
        ownerId,
        dueDate: dueDate || null,
        confirmFlagged: confirmed,
      };
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

  const heading = epic ? "Stories and tasks" : "Tasks";
  const noun = epic
    ? childType === "STORY"
      ? "story"
      : "task"
    : parentType === "TASK"
      ? "subtask"
      : "task";

  return (
    <section className="space-y-3" aria-label={heading}>
      {confirmElement}
      <div className="flex items-center gap-3">
        <h3 className="heading text-sm">{heading}</h3>
        {progress.total > 0 && (
          <ProgressBar
            done={progress.done}
            total={progress.total}
            color={projectColor}
            className="max-w-48 flex-1"
          />
        )}
      </div>
      {items.length > 0 && (
        <ul className="bg-card rounded-tile border p-1">
          {items.map((s) => {
            const owner = s.ownerId ? (memberById.get(s.ownerId) ?? s.owner) : null;
            const isDone = s.status === TaskStatus.COMPLETED;
            const story = s.type === "STORY";
            const own = rollUp(s.subtasks.map((g) => ({ status: g.status })));
            return (
              <li
                key={s.id}
                className="hover:bg-muted/60 rounded-field [li+&]:before:bg-border relative flex min-h-11 items-center gap-2.5 px-2 py-1.5 text-sm transition-colors [li+&]:before:absolute [li+&]:before:start-10 [li+&]:before:end-2 [li+&]:before:top-0 [li+&]:before:h-px"
              >
                {story ? (
                  <TaskTypeChip type="STORY" iconOnly />
                ) : (
                  <TaskCheck
                    size={18}
                    done={isDone}
                    onToggle={() => toggle(s)}
                    label={isDone ? `Reopen ${s.title}` : `Complete ${s.title}`}
                  />
                )}
                <button
                  type="button"
                  className={cn(
                    "min-w-0 flex-1 truncate text-left font-medium hover:underline",
                    isDone && "text-muted-foreground line-through",
                  )}
                  onClick={() => onOpen?.(s.id)}
                >
                  <TaskTitle>{s.title}</TaskTitle>
                </button>
                {story && own.total > 0 && (
                  <ProgressBar
                    done={own.done}
                    total={own.total}
                    color={projectColor}
                    className="w-24"
                  />
                )}
                {s.status === TaskStatus.BLOCKED && (
                  <span className="text-tint-danger-foreground text-xs font-medium">Blocked</span>
                )}
                <DueLabel
                  dueDate={s.dueDate}
                  todayKey={org.todayKey}
                  done={isDone}
                  className="text-muted-foreground text-xs"
                />
                {owner ? (
                  <UserAvatar user={owner} size="xs" />
                ) : (
                  <span className="text-muted-foreground text-xs">No owner</span>
                )}
                {onOpen && (
                  <ChevronRight className="text-muted-foreground size-4" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canAdd && (
        <div className="flex flex-wrap items-center gap-2">
          {epic && (
            <Segmented
              label="Add a"
              value={childType}
              onSelect={(v) => setChildType(v as "TASK" | "STORY")}
              options={[
                { value: "STORY", label: "Story" },
                { value: "TASK", label: "Task" },
              ]}
            />
          )}
          <Input
            aria-label={`New ${noun}`}
            placeholder={`Add a ${noun}…`}
            value={title}
            className="h-10 min-w-40 flex-1"
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
            aria-label={`Due date for the new ${noun}`}
            value={dueDate}
            className="h-10 w-36"
            onChange={(e) => setDueDate(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void add()}
            disabled={isPending || !title.trim()}
          >
            Add
          </Button>
        </div>
      )}
      {error && <p className="text-destructive text-sm">{error}</p>}
    </section>
  );
}
