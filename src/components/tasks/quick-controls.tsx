"use client";

import { useOptimistic, useTransition } from "react";

import { setTaskPriority, setTaskStatus } from "@/app/app/[orgSlug]/tasks/actions";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TaskPriority, TaskStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { useBlockedReason } from "./prompts";
import { STATUS_LABELS } from "./status-select";
import { PRIORITY_LABELS, PriorityDot } from "./task-badges";
import { useTasks } from "./tasks-context";

/**
 * Inline status, priority and done controls with optimistic updates
 * (useOptimistic inside a transition): the change shows on the current
 * frame, the Server Action runs, and the refreshed server render replaces
 * the optimistic value. A refusal reverts and announces why.
 */

interface QuickTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
}

export function QuickStatus({
  task,
  disabled,
  quiet,
  className,
}: {
  task: QuickTask;
  disabled?: boolean;
  /** Borderless, for list rows where a column of boxes would shout. */
  quiet?: boolean;
  className?: string;
}) {
  const { org, announce } = useTasks();
  const [status, setOptimistic] = useOptimistic(task.status);
  const [, startTransition] = useTransition();
  const [prompt, askReason] = useBlockedReason();

  async function change(next: TaskStatus) {
    if (next === status) return;
    let reason: string | null = null;
    if (next === TaskStatus.BLOCKED) {
      reason = await askReason(task.title);
      if (!reason) return;
    }
    startTransition(async () => {
      setOptimistic(next);
      const result = await setTaskStatus(org.id, task.id, next, reason);
      if (result.error) announce(result.error);
    });
  }

  return (
    <>
      {prompt}
      <Select
        value={status}
        onValueChange={(v) => void change(v as TaskStatus)}
        disabled={disabled}
      >
        <SelectTrigger
          size="sm"
          aria-label={`Status of ${task.title}`}
          className={cn(
            "h-7 w-[8.5rem] text-xs",
            quiet &&
              "text-muted-foreground hover:text-foreground hover:bg-muted data-[state=open]:bg-muted border-transparent bg-transparent shadow-none transition-colors duration-150",
            status === TaskStatus.BLOCKED && "text-destructive",
            className,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent onClick={(e) => e.stopPropagation()}>
          {Object.values(TaskStatus).map((s) => (
            <SelectItem key={s} value={s}>
              {STATUS_LABELS[s]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

export function QuickPriority({
  task,
  disabled,
  className,
}: {
  task: QuickTask;
  disabled?: boolean;
  className?: string;
}) {
  const { org, announce } = useTasks();
  const [priority, setOptimistic] = useOptimistic(task.priority);
  const [, startTransition] = useTransition();

  function change(next: TaskPriority) {
    if (next === priority) return;
    startTransition(async () => {
      setOptimistic(next);
      const result = await setTaskPriority(org.id, task.id, next);
      if (result.error) announce(result.error);
    });
  }

  return (
    <Select value={priority} onValueChange={(v) => change(v as TaskPriority)} disabled={disabled}>
      <SelectTrigger
        size="sm"
        aria-label={`Priority of ${task.title}`}
        className={cn("h-7 w-[6.5rem] text-xs", className)}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex items-center gap-1.5">
          <PriorityDot priority={priority} />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent onClick={(e) => e.stopPropagation()}>
        {Object.values(TaskPriority).map((p) => (
          <SelectItem key={p} value={p}>
            {PRIORITY_LABELS[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A checkbox that completes (or reopens) a task. */
export function QuickDone({ task, disabled }: { task: QuickTask; disabled?: boolean }) {
  const { org, announce } = useTasks();
  const [status, setOptimistic] = useOptimistic(task.status);
  const [, startTransition] = useTransition();
  const done = status === TaskStatus.COMPLETED;

  function toggle() {
    const next = done ? TaskStatus.NOT_STARTED : TaskStatus.COMPLETED;
    startTransition(async () => {
      setOptimistic(next);
      const result = await setTaskStatus(org.id, task.id, next);
      if (result.error) announce(result.error);
    });
  }

  return (
    <Checkbox
      checked={done}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={toggle}
      aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
    />
  );
}
