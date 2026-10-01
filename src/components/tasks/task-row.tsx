"use client";

import { ListChecks, MessageSquare } from "lucide-react";

import { PinToggle } from "@/components/pins/pins-context";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { canEditTask } from "@/lib/tasks/access";
import { cn } from "@/lib/utils";

import { QuickDone, QuickStatus } from "./quick-controls";
import {
  BlockedNote,
  DueLabel,
  FlagBadge,
  PriorityDot,
  PrivateMark,
  isTaskFlagged,
  isTaskPrivate,
} from "./task-badges";
import { accessSubjectOf, useTasks } from "./tasks-context";
import { TaskItemMenu } from "./task-item-menu";
import type { TaskItem } from "./types";

/**
 * One task as a list row — the Week, the Team lanes and the request queue
 * all use this, so a task reads the same wherever you meet it.
 *
 * Labels and the above-level flag sit immediately after the title, because
 * they describe the task and the eye is already there; only the things you
 * scan DOWN a column for — due date, owner, status — are pushed to the right
 * edge where they line up. On a phone the due date moves into the meta line
 * rather than disappearing: it is the one fact you came for.
 */
export function TaskRow({
  task,
  showOwner = false,
  showRole = true,
  showProject = true,
  className,
}: {
  task: TaskItem;
  showOwner?: boolean;
  showRole?: boolean;
  showProject?: boolean;
  className?: string;
}) {
  const { org, viewer, actor, showTask } = useTasks();
  const access = accessSubjectOf(task);
  const editable = canEditTask(actor, access);
  const done = task.status === "COMPLETED";
  const priv = isTaskPrivate(task);
  const flagged = isTaskFlagged(task);
  const involvedOnly =
    showRole &&
    task.ownerId !== viewer.userId &&
    task.assignees.some((a) => a.userId === viewer.userId);
  const subtasksDone = task.subtasks.filter((s) => s.status === "COMPLETED").length;

  return (
    <li
      className={cn(
        "group hover:bg-muted/50 focus-within:bg-muted/50 flex items-center gap-2.5 px-3 py-2 transition-colors duration-150 sm:gap-3",
        className,
      )}
    >
      <QuickDone task={task} disabled={!editable} />

      <button
        type="button"
        onClick={() => showTask(task)}
        className="focus-visible:ring-ring min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <PriorityDot priority={task.priority} />
            {priv && <PrivateMark />}
            <span className="min-w-0 truncate text-sm">
              {task.parentTask && (
                <span className="text-muted-foreground">{task.parentTask.title} / </span>
              )}
              <span className={cn("font-medium", done && "text-muted-foreground line-through")}>
                {task.title}
              </span>
            </span>
          </span>
          {flagged && <FlagBadge />}
          {task.labels.slice(0, 3).map(({ label }) => (
            <Badge
              key={label.id}
              style={{ backgroundColor: label.color, color: "white" }}
              className="border-0"
            >
              {label.name}
            </Badge>
          ))}
        </span>

        <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs">
          {/* On a phone the right-hand cluster is gone, so the due date lives here. */}
          <DueLabel
            dueDate={task.dueDate}
            todayKey={org.todayKey}
            done={done}
            className="sm:hidden"
          />
          {priv && <span className="font-medium">Private</span>}
          {showProject && task.project && <span className="truncate">{task.project.name}</span>}
          {involvedOnly && <span>Involved</span>}
          {task.subtasks.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListChecks className="size-3" aria-hidden="true" />
              {subtasksDone}/{task.subtasks.length}
            </span>
          )}
          {task._count.comments > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3" aria-hidden="true" />
              {task._count.comments}
            </span>
          )}
          {task.status === "BLOCKED" && (
            <BlockedNote reason={task.blockedReason} className="max-w-full" />
          )}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        <DueLabel
          dueDate={task.dueDate}
          todayKey={org.todayKey}
          done={done}
          className="text-muted-foreground hidden w-24 justify-end text-xs sm:flex"
        />
        {showOwner &&
          (task.owner ? (
            <UserAvatar user={task.owner} size="sm" />
          ) : (
            <span
              className="text-muted-foreground border-border hidden size-6 items-center justify-center rounded-full border border-dashed text-[10px] sm:flex"
              title="No owner yet"
            >
              ?
            </span>
          ))}
        <QuickStatus task={task} disabled={!editable} quiet className="hidden md:flex" />
        <PinToggle
          path={`/tasks/${task.id}`}
          label={task.title}
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        />
        <TaskItemMenu
          task={{ id: task.id, title: task.title, subtaskCount: task.subtasks.length }}
          editable={editable}
          onOpen={() => showTask(task)}
          className="opacity-60 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
        />
      </div>
    </li>
  );
}
