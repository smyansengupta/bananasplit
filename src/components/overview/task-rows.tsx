"use client";

import { Ban, CalendarDays, Lock } from "@/components/icons";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { setTaskStatus } from "@/app/app/[orgSlug]/tasks/actions";
import { Badge } from "@/components/ui/badge";
import { TagChip } from "@/components/ui/chip";
import { toast } from "@/components/ui/toaster";
import { TaskStatus } from "@/generated/prisma/enums";
import type { DueTone } from "@/lib/overview/format";
import { cn } from "@/lib/utils";

import { TaskCheck } from "./task-check";

/**
 * My tasks' rows (redesign guide 7.11, 16): a 22px circle check, the title,
 * a meta line (the epic as a tag chip, the due label by urgency), and a
 * High chip on the right. Checking one marks it done through the tasks
 * action (the same checks as the task page), with the check's spring and a
 * "Done: …" toast with Undo; the row leaves when the page refreshes.
 */

export interface TaskRowData {
  id: string;
  title: string;
  href: string;
  status: TaskStatus;
  private: boolean;
  /** The epic it's part of (when the context line doesn't already name it). */
  epic: { name: string; color: string | null } | null;
  /** "Subtask of …", when it is one. */
  context: string | null;
  due: { text: string; tone: DueTone } | null;
  high: boolean;
}

const DUE_TONE: Record<DueTone, string> = {
  danger: "text-tint-danger-foreground font-semibold",
  bold: "text-foreground font-semibold",
  muted: "text-muted-foreground",
};

export function TaskRows({ orgId, tasks }: { orgId: string; tasks: readonly TaskRowData[] }) {
  return (
    <ul>
      {tasks.map((task, i) => (
        <TaskRow key={task.id} orgId={orgId} task={task} first={i === 0} />
      ))}
    </ul>
  );
}

function TaskRow({ orgId, task, first }: { orgId: string; task: TaskRowData; first: boolean }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const previous = useRef(task.status);

  function complete() {
    if (done) return;
    setError(null);
    setDone(true);
    start(async () => {
      const result = await setTaskStatus(orgId, task.id, TaskStatus.COMPLETED);
      if (result.error) {
        setDone(false);
        setError(result.error);
        return;
      }
      toast({
        title: `Done: ${task.title}`,
        tone: "success",
        action: {
          label: "Undo",
          run: async () => (await setTaskStatus(orgId, task.id, previous.current)).error,
        },
      });
    });
  }

  return (
    <li
      className={cn(
        "group/row hover:bg-muted/60 rounded-field relative -mx-3 flex items-center gap-3.5 px-3 py-3 transition-[background-color,opacity] duration-300",
        !first &&
          "before:bg-border before:absolute before:top-0 before:right-3 before:left-12 before:h-px hover:before:opacity-0",
        done && "opacity-70",
      )}
    >
      <TaskCheck checked={done} onCheck={complete} label={`Complete: ${task.title}`} />
      <div className="min-w-0 flex-1">
        <Link
          href={task.href}
          className={cn(
            "flex min-w-0 items-center gap-1.5 text-[15px] font-medium after:absolute after:inset-0 after:rounded-[inherit]",
            done && "text-muted-foreground line-through",
          )}
        >
          {task.private && (
            <Lock className="text-muted-foreground size-3.5 shrink-0" aria-label="Private task" />
          )}
          <span className="truncate">{task.title}</span>
        </Link>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
          {task.epic && (
            <TagChip color={task.epic.color ?? "var(--chart-3)"}>{task.epic.name}</TagChip>
          )}
          {task.status === TaskStatus.BLOCKED && (
            <span className="text-tint-danger-foreground inline-flex items-center gap-1 font-medium">
              <Ban className="size-3.5" aria-hidden="true" />
              Blocked
            </span>
          )}
          {task.due && (
            <span
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap",
                DUE_TONE[task.due.tone],
              )}
            >
              <CalendarDays className="size-3.5" aria-hidden="true" />
              {task.due.text}
            </span>
          )}
          {task.context && <span className="text-muted-foreground truncate">{task.context}</span>}
        </div>
        {error && (
          <p role="alert" className="text-destructive mt-1 text-xs">
            {error}
          </p>
        )}
      </div>
      {task.high && (
        <Badge variant="accent" className="shrink-0">
          High
        </Badge>
      )}
    </li>
  );
}
