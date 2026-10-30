"use client";

import { MessageSquare } from "@/components/icons";

import { PinToggle } from "@/components/pins/pins-context";
import { Badge } from "@/components/ui/badge";
import { TagChip } from "@/components/ui/chip";
import { canEditTask } from "@/lib/tasks/access";
import { rollUp } from "@/lib/tasks/hierarchy";
import { epicColor, epicOf } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";

import { QuickDone } from "./quick-controls";
import { QuickDue, QuickOwner } from "./quick-edit";
import { BlockedNote, FlagBadge, PrivateMark, isTaskFlagged, isTaskPrivate } from "./task-badges";
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
 * The title opens the task (its click covers the whole row); the date and
 * the owner's face change in place without opening anything.
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
  const { viewer, actor, showTask } = useTasks();
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
  const shownTags = task.labels.slice(0, 3);
  const moreTags = task.labels.length - shownTags.length;

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
      <span className="relative z-10 flex">
        {task.type === "EPIC" ? (
          <TaskTypeChip type="EPIC" iconOnly />
        ) : (
          <QuickDone task={task} disabled={!editable} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => showTask(task)}
          data-task-key={task.id}
          data-task-title={task.title}
          data-task-status={task.status}
          className="focus-visible:outline-foreground flex min-w-0 items-center gap-1.5 rounded-md text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {priv && <PrivateMark />}
          {task.type === "STORY" && <TaskTypeChip type="STORY" iconOnly />}
          {/* The whole title, wrapping: never cut off. */}
          <span className="min-w-0 text-[15px] leading-snug break-words">
            {/* The story it's in (its epic is the chip below). */}
            {showParent && task.parentTask && task.parentTask.type !== "EPIC" && (
              <span className="text-muted-foreground">{task.parentTask.title} / </span>
            )}
            <span className={cn("font-medium", done && "text-muted-foreground line-through")}>
              <TaskTitle>{task.title}</TaskTitle>
            </span>
          </span>
          {flagged && <FlagBadge />}
        </button>

        <span className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
          {showEpic && epic && epic.id !== task.id && <TagChip color={color}>{epic.title}</TagChip>}
          <span className="relative z-10 inline-flex">
            <QuickDue task={task} done={done} disabled={!editable} />
          </span>
          {shownTags.map(({ label }) => (
            <TagChip key={label.id} color={label.color}>
              {label.name}
            </TagChip>
          ))}
          {moreTags > 0 && <span className="text-xs font-medium">+{moreTags}</span>}
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
      </div>

      <div className="relative z-10 flex shrink-0 items-center gap-2">
        {task.priority === "HIGH" && !done && (
          <Badge variant="accent" className="max-sm:hidden">
            High
          </Badge>
        )}
        {showOwner && <QuickOwner task={task} disabled={!editable} />}
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
