"use client";

import { MessageSquare } from "@/components/icons";

import { PinToggle } from "@/components/pins/pins-context";
import { Badge } from "@/components/ui/badge";
import { TagChip } from "@/components/ui/chip";
import { UserAvatar } from "@/components/user-avatar";
import { canEditTask } from "@/lib/tasks/access";
import { rollUp } from "@/lib/tasks/hierarchy";
import { epicColor, epicOf } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";

import { QuickDone } from "./quick-controls";
import {
  BlockedNote,
  DueLabel,
  FlagBadge,
  PrivateMark,
  isTaskFlagged,
  isTaskPrivate,
} from "./task-badges";
import { TaskItemMenu } from "./task-item-menu";
import { ProgressBar, TaskTypeChip } from "./task-type";
import { TaskTitle } from "./task-title";
import { accessSubjectOf, useTasks } from "./tasks-context";
import type { TaskItem } from "./types";

/**
 * One task as a list row (Moonstone 7.11) — the Week, the List and
 * Personal home all use it, so a task reads the same wherever you meet it.
 * The circle, the title, a meta row (epic chip, due date, tags, progress,
 * comments), then the priority chip, the owner and the ••• on the right.
 * Rows become a soft tile on hover; a full-width line ends each task.
 * `depth` hangs a story's tasks under it in the List, on a rail from the
 * story's circle.
 */
export function TaskRow({
  task,
  showOwner = false,
  showRole = true,
  showEpic = true,
  showParent = true,
  depth = 0,
  className,
}: {
  task: TaskItem;
  showOwner?: boolean;
  showRole?: boolean;
  /** The epic's chip (off where the row already sits under its epic). */
  showEpic?: boolean;
  /** The "Parent / " breadcrumb (off where the row already sits under its parent). */
  showParent?: boolean;
  depth?: 0 | 1 | 2;
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
  const progress = rollUp(task.subtasks);
  const epic = epicOf(task);
  const color = epicColor(epic);

  return (
    <li
      className={cn(
        "group hover:bg-muted/60 focus-within:bg-muted/60 rounded-field relative flex items-center gap-3 px-3 py-3 transition-colors duration-150 sm:gap-3.5",
        // A full-width line between tasks, so each one visibly ends.
        depth === 0 &&
          "[li+&]:before:bg-border [li+&]:before:absolute [li+&]:before:inset-x-3 [li+&]:before:top-0 [li+&]:before:h-px",
        // A task under a story hangs off a rail from the story's circle
        // instead, so the two read as one group.
        depth > 0 &&
          "after:bg-border after:absolute after:inset-y-0 after:start-[23px] after:w-0.5 after:rounded-full",
        depth === 1 && "ps-11",
        depth === 2 && "ps-16 after:start-[3.25rem]",
        done && "opacity-80",
        className,
      )}
    >
      {task.type === "EPIC" ? (
        <TaskTypeChip type="EPIC" iconOnly />
      ) : (
        <QuickDone task={task} disabled={!editable} />
      )}

      <button
        type="button"
        onClick={() => showTask(task)}
        className="focus-visible:outline-foreground min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {priv && <PrivateMark />}
          {task.type === "STORY" && <TaskTypeChip type="STORY" iconOnly />}
          {/* Two lines on a phone, where one cut most titles off. */}
          <span className="min-w-0 truncate text-[15px] leading-snug max-md:line-clamp-2 max-md:whitespace-normal">
            {/* The story it's in (its epic is the chip below). */}
            {showParent && task.parentTask && task.parentTask.type !== "EPIC" && (
              <span className="text-muted-foreground">{task.parentTask.title} / </span>
            )}
            <span className={cn("font-medium", done && "text-muted-foreground line-through")}>
              <TaskTitle>{task.title}</TaskTitle>
            </span>
          </span>
          {flagged && <FlagBadge />}
        </span>

        <span className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
          {showEpic && epic && epic.id !== task.id && <TagChip color={color}>{epic.title}</TagChip>}
          <DueLabel dueDate={task.dueDate} todayKey={org.todayKey} done={done} />
          {task.labels.slice(0, 3).map(({ label }) => (
            <TagChip key={label.id} color={label.color}>
              {label.name}
            </TagChip>
          ))}
          {priv && <span className="font-medium">Private</span>}
          {involvedOnly && <span>Involved</span>}
          {progress.total > 0 && (
            <ProgressBar
              done={progress.done}
              total={progress.total}
              color={color}
              className="w-24"
            />
          )}
          {task._count.comments > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5" aria-hidden="true" />
              {task._count.comments}
            </span>
          )}
          {task.status === "BLOCKED" && (
            <BlockedNote reason={task.blockedReason} className="max-w-full" />
          )}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-2">
        {task.priority === "HIGH" && !done && (
          <Badge variant="accent" className="max-sm:hidden">
            High
          </Badge>
        )}
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
        <PinToggle
          path={`/tasks/${task.id}`}
          label={task.title}
          className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 max-sm:hidden"
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
