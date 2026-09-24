"use client";

import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { canEditTask, canTriage } from "@/lib/tasks/access";
import { cn } from "@/lib/utils";

import { QuickDone, QuickPriority, QuickStatus } from "./quick-controls";
import { BlockedNote, DueLabel, FlagBadge, isTaskFlagged } from "./task-badges";
import { accessSubjectOf, useTasks } from "./tasks-context";
import type { TaskItem } from "./types";

/**
 * One task as a list row (My Tasks, Team, the intake queue): done checkbox,
 * title with its parent, flags, due date, and optimistic priority and status.
 */
export function TaskRow({
  task,
  onOpen,
  showOwner = false,
  showRole = true,
}: {
  task: TaskItem;
  onOpen: (taskId: string) => void;
  showOwner?: boolean;
  showRole?: boolean;
}) {
  const { org, viewer, actor } = useTasks();
  const access = accessSubjectOf(task);
  const editable = canEditTask(actor, access);
  const triage = canTriage(actor, access);
  const done = task.status === "COMPLETED";
  const involvedOnly = showRole && task.ownerId !== viewer.userId && task.assignees.some((a) => a.userId === viewer.userId);

  return (
    <li className="hover:bg-muted/40 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <QuickDone task={task} disabled={!editable} />
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        className="min-w-0 flex-1 basis-48 text-left"
        aria-label={`Open ${task.title}`}
      >
        <span className="block truncate text-sm">
          {task.parentTask && <span className="text-muted-foreground">{task.parentTask.title} / </span>}
          <span className={cn("font-medium", done && "text-muted-foreground line-through")}>{task.title}</span>
        </span>
        <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
          {task.project && <span>{task.project.name}</span>}
          {involvedOnly && <span>Involved</span>}
          {task.status === "BLOCKED" && <BlockedNote reason={task.blockedReason} />}
        </span>
      </button>
      <div className="flex flex-wrap items-center gap-2">
        {isTaskFlagged(task) && <FlagBadge />}
        {task.labels.slice(0, 2).map(({ label }) => (
          <Badge key={label.id} style={{ backgroundColor: label.color, color: "white" }} className="border-0">
            {label.name}
          </Badge>
        ))}
        <DueLabel dueDate={task.dueDate} todayKey={org.todayKey} done={done} className="text-muted-foreground w-24 text-xs" />
        {showOwner &&
          (task.owner ? (
            <UserAvatar user={task.owner} size="sm" />
          ) : (
            <span className="text-muted-foreground w-6 text-center text-xs" title="No owner">
              –
            </span>
          ))}
        <QuickPriority task={task} disabled={!editable || !triage} />
        <QuickStatus task={task} disabled={!editable} />
      </div>
    </li>
  );
}
