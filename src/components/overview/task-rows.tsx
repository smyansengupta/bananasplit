"use client";

import { Ban, CalendarDays, Flag, Lock } from "@/components/icons";
import Link from "next/link";
import { useRef, useState, useTransition } from "react";

import { setTaskStatus } from "@/app/app/[orgSlug]/tasks/actions";
import { PushBackButton } from "@/components/tasks/overdue-actions";
import { TagChip } from "@/components/ui/chip";
import { toast } from "@/components/ui/toaster";
import { TaskStatus } from "@/generated/prisma/enums";
import type { DueTone } from "@/lib/overview/format";
import { cn } from "@/lib/utils";

import { LinkChips, type ItemRef } from "./connections";
import { TaskCheck } from "./task-check";

/**
 * My tasks' rows (redesign guide 7.11, 16): a 22px circle check, the title,
 * a meta line (the epic as a tag chip, the due label by urgency), chips for
 * what the task is linked to (its event, meeting or note), and a High chip
 * on the right. Checking one marks it done through the tasks
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
  /** Past its due date: Push back sits beside the date. */
  late?: boolean;
  high: boolean;
  /** What it's linked to. */
  chips?: readonly ItemRef[];
}

/** The due date as a pill on the right: red when late or today, firm tomorrow, quiet after. */
const DUE_TONE: Record<DueTone, string> = {
  danger: "bg-tint-danger text-tint-danger-foreground",
  bold: "bg-tint-info text-tint-info-foreground",
  muted: "bg-muted text-muted-foreground",
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
        "group/row hover:bg-muted/60 rounded-field relative -mx-3 flex items-center gap-3.5 px-3 py-2.5 transition-[background-color,opacity] duration-300",
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
          <span className="break-words">{task.title}</span>
        </Link>
        {(task.epic || task.context || task.status === TaskStatus.BLOCKED) && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]">
            {task.epic && (
              <TagChip color={task.epic.color ?? "var(--chart-3)"}>{task.epic.name}</TagChip>
            )}
            {task.status === TaskStatus.BLOCKED && (
              <span className="text-tint-danger-foreground inline-flex items-center gap-1 font-medium">
                <Ban className="size-3.5" aria-hidden="true" />
                Blocked
              </span>
            )}
            {task.context && (
              <span className="text-muted-foreground min-w-0 truncate">{task.context}</span>
            )}
          </div>
        )}
        {task.chips && task.chips.length > 0 && (
          <LinkChips items={task.chips} className="relative z-10 mt-1.5" />
        )}
        {error && (
          <p role="alert" className="text-destructive mt-1 text-xs">
            {error}
          </p>
        )}
      </div>
      <span className="flex shrink-0 items-center gap-1.5">
        {task.late && !done && (
          <span className="relative z-10">
            <PushBackButton orgId={orgId} taskId={task.id} title={task.title} size="icon-sm" />
          </span>
        )}
        {task.high && (
          <span
            title="High priority"
            className="bg-tint-accent text-tint-accent-foreground grid size-6 place-items-center rounded-full"
          >
            <Flag className="size-3.5" aria-label="High priority" />
          </span>
        )}
        {task.due && (
          <span
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[12px] font-semibold whitespace-nowrap",
              DUE_TONE[task.due.tone],
            )}
          >
            <CalendarDays className="size-3.5" aria-hidden="true" />
            {task.due.text.replace(/^Overdue, /, "Late, ")}
          </span>
        )}
      </span>
    </li>
  );
}
