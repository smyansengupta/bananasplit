import { MessageSquare } from "@/components/icons";

import { Badge } from "@/components/ui/badge";
import { TagChip } from "@/components/ui/chip";
import { UserAvatar } from "@/components/user-avatar";
import { rollUp } from "@/lib/tasks/hierarchy";
import { epicColor, epicOf } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";

import {
  BlockedNote,
  DueLabel,
  FlagBadge,
  PrivateBadge,
  isTaskFlagged,
  isTaskPrivate,
} from "./task-badges";
import { ProgressBar, TaskTypeChip } from "./task-type";
import type { TaskItem } from "./types";

export type TaskCardData = Pick<
  TaskItem,
  | "id"
  | "type"
  | "title"
  | "status"
  | "visibility"
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
 * A board card (Moonstone 10.1): a rounded tile with the epic chip (and
 * the priority chip), the title, the subtask bar in the epic's colour with
 * "2/3", and a meta row of date, comments and faces.
 * Plain and presentational: inside a sortable list the wrapper owns click,
 * focus and drag. A private task gets a dashed edge as well as the badge
 * (nothing else on the board is dashed). `dragging` is the lifted copy.
 */
export function TaskCard({
  task,
  todayKey,
  dragging = false,
  showEpic = true,
  check,
}: {
  task: TaskCardData;
  todayKey: string;
  dragging?: boolean;
  /** The parent epic's name (off inside an epic's swimlane). */
  showEpic?: boolean;
  /** The completion circle, for cards in the Completed column. */
  check?: React.ReactNode;
}) {
  const done = task.status === "COMPLETED";
  const flagged = isTaskFlagged(task);
  const priv = isTaskPrivate(task);
  const progress = rollUp(task.subtasks);
  const epic = epicOf(task);
  const color = epicColor(epic);
  const people = [
    ...(task.owner ? [task.owner] : []),
    ...task.assignees.map((a) => a.user).filter((u) => u.id !== task.ownerId),
  ];

  return (
    <div
      className={cn(
        "bg-card edge rounded-tile flex w-full flex-col gap-2.5 p-3.5 text-sm transition-[box-shadow,transform] duration-200 ease-(--ease-ink)",
        "group-hover:shadow-e2 motion-safe:group-hover:-translate-y-0.5",
        priv && "border border-dashed",
        dragging &&
          "shadow-e2 outline-brand-accent scale-[1.02] rotate-[2.5deg] outline-2 -outline-offset-1 motion-reduce:rotate-0",
      )}
    >
      {((showEpic && epic) || task.priority === "HIGH" || task.type === "STORY") && !done && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 pe-7">
          {showEpic && epic && <TagChip color={color}>{epic.title}</TagChip>}
          {task.type === "STORY" && <TaskTypeChip type="STORY" />}
          {task.priority === "HIGH" && <Badge variant="accent">High</Badge>}
        </div>
      )}
      <div className="flex min-w-0 items-start gap-2">
        {check}
        <p
          className={cn(
            "min-w-0 flex-1 pe-6 text-[15px] leading-[1.3] font-semibold text-pretty",
            done && "text-muted-foreground font-medium",
          )}
        >
          {task.title}
        </p>
      </div>

      {(priv || flagged || task.labels.length > 0) && !done && (
        <div className="flex flex-wrap gap-1.5">
          {priv && <PrivateBadge />}
          {flagged && <FlagBadge />}
          {task.labels.slice(0, 3).map(({ label }) => (
            <TagChip key={label.id} color={label.color}>
              {label.name}
            </TagChip>
          ))}
        </div>
      )}

      {task.status === "BLOCKED" && <BlockedNote reason={task.blockedReason} />}

      {progress.total > 0 && !done && (
        <ProgressBar done={progress.done} total={progress.total} color={color} />
      )}

      <div className="text-muted-foreground flex items-center gap-2.5 text-[13px]">
        <DueLabel dueDate={task.dueDate} todayKey={todayKey} done={done} />
        {task._count.comments > 0 && (
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {task._count.comments}
          </span>
        )}
        <span className="flex-1" />
        {people.length > 0 && (
          <span className="flex shrink-0 items-center">
            {people.slice(0, 3).map((u, i) => (
              <UserAvatar
                key={u.id}
                user={u}
                size="sm"
                className={cn("ring-card ring-2", i > 0 && "-ms-2")}
              />
            ))}
            {people.length > 3 && (
              <span className="ms-1 text-xs font-medium">+{people.length - 3}</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
