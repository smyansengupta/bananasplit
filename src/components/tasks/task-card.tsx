import { ListChecks, MessageSquare } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";

import { BlockedNote, DueLabel, FlagBadge, PriorityDot, isTaskFlagged } from "./task-badges";
import type { TaskItem } from "./types";

export type TaskCardData = Pick<
  TaskItem,
  | "id"
  | "title"
  | "status"
  | "priority"
  | "dueDate"
  | "owner"
  | "ownerId"
  | "ownerFlagged"
  | "assignees"
  | "labels"
  | "subtasks"
  | "blockedReason"
  | "parentTask"
  | "_count"
>;

/**
 * Plain presentational card: no button role of its own. Inside a sortable
 * list the wrapper (SortableTaskCard) owns click, focus and drag on a single
 * element; a nested <button> here would compete with it.
 */
export function TaskCard({ task, todayKey }: { task: TaskCardData; todayKey: string }) {
  const completedSubtasks = task.subtasks.filter((s) => s.status === "COMPLETED").length;
  const done = task.status === "COMPLETED";
  const flagged = isTaskFlagged(task);

  return (
    <div className="bg-card w-full space-y-2 rounded-md border p-3 text-sm shadow-sm">
      {task.parentTask && <p className="text-muted-foreground truncate text-xs">{task.parentTask.title} /</p>}
      <p className={done ? "text-muted-foreground font-medium line-through" : "font-medium"}>{task.title}</p>

      {(flagged || task.labels.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {flagged && <FlagBadge />}
          {task.labels.map(({ label }) => (
            <Badge key={label.id} style={{ backgroundColor: label.color, color: "white" }} className="border-0">
              {label.name}
            </Badge>
          ))}
        </div>
      )}

      {task.status === "BLOCKED" && <BlockedNote reason={task.blockedReason} />}

      <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-3">
          <PriorityDot priority={task.priority} />
          <DueLabel dueDate={task.dueDate} todayKey={todayKey} done={done} />
          {task.subtasks.length > 0 && (
            <span className="flex items-center gap-1">
              <ListChecks className="size-3.5" aria-hidden="true" />
              {completedSubtasks}/{task.subtasks.length}
            </span>
          )}
          {task._count.comments > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3.5" aria-hidden="true" />
              {task._count.comments}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center -space-x-1.5">
          {task.owner && <UserAvatar user={task.owner} size="sm" />}
          {task.assignees.slice(0, 2).map(({ user }) => (
            <UserAvatar key={user.id} user={user} size="xs" />
          ))}
          {task.assignees.length > 2 && <span className="pl-2">+{task.assignees.length - 2}</span>}
        </div>
      </div>
    </div>
  );
}
