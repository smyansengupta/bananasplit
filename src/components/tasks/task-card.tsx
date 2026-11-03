import { Bookmark, Clock } from "@/components/icons";

import { UserAvatar } from "@/components/user-avatar";
import { daysBetweenKeys, dueDateKey } from "@/lib/tasks/dates";
import { epicColor, epicOf } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";

import { DueLabel, isTaskPrivate } from "./task-badges";
import { TaskTitle } from "./task-title";
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

/** Priority in words under the title: High in red, Medium in ink, Low quiet. */
const PRIORITY: Record<string, { label: string; className: string }> = {
  HIGH: { label: "High", className: "text-destructive" },
  MEDIUM: { label: "Medium", className: "text-foreground" },
  LOW: { label: "Low", className: "text-muted-foreground" },
};

/**
 * A board card. The epic is a solid band across the top in its colour (with
 * the Story bookmark on a story); no epic, no band. Then the title, then the
 * priority in words and the tags as a dot and a name. The foot is the date
 * (a red count of days once it's late), then the one ambient button beside
 * the faces in the right corner; with nobody on it (Take it) the button
 * takes the corner itself. Nothing else: comments, subtasks and the blocked
 * note live on the task.
 * Plain and presentational: inside a sortable list the wrapper owns click,
 * focus and drag. A private task keeps its dashed edge. `dragging` is the
 * lifted copy.
 */
export function TaskCard({
  task,
  todayKey,
  dragging = false,
  showEpic = true,
  check,
  ambient,
}: {
  task: TaskCardData;
  todayKey: string;
  dragging?: boolean;
  /** The parent epic's band (off inside an epic's swimlane). */
  showEpic?: boolean;
  /** The completion circle, for cards in the Completed column. */
  check?: React.ReactNode;
  /** Its one ambient button (Push back, Nudge, Take it...), beside the faces. */
  ambient?: React.ReactNode;
}) {
  const done = task.status === "COMPLETED";
  const priv = isTaskPrivate(task);
  const epic = showEpic ? epicOf(task) : null;
  const story = task.type === "STORY";
  const priority = PRIORITY[task.priority];
  const dueKey = task.dueDate ? dueDateKey(task.dueDate) : null;
  const late = !done && dueKey && dueKey < todayKey ? daysBetweenKeys(dueKey, todayKey) : 0;
  const people = [
    ...(task.owner ? [task.owner] : []),
    ...task.assignees.map((a) => a.user).filter((u) => u.id !== task.ownerId),
  ];

  return (
    <div
      className={cn(
        "bg-card edge rounded-tile flex w-full flex-col gap-2.5 overflow-hidden p-3.5 text-sm transition-[box-shadow,transform] duration-200 ease-(--ease-ink)",
        "group-hover:shadow-e2 motion-safe:group-hover:-translate-y-0.5",
        priv && "border border-dashed",
        dragging &&
          "shadow-e2 outline-brand-accent scale-[1.02] rotate-[2.5deg] outline-2 -outline-offset-1 motion-reduce:rotate-0",
      )}
    >
      {epic && (
        // The card's own colour as the ink: white on the light theme, dark on
        // the dark one, where the tag colours are the light ones.
        <div
          className="text-card -mx-3.5 -mt-3.5 mb-0.5 flex min-w-0 items-center gap-1.5 py-2 ps-3.5 pe-10 text-[12.5px] font-bold"
          style={{ background: epicColor(epic) }}
        >
          {story && <Bookmark className="size-3.5 shrink-0" aria-label="Story" />}
          <span className="truncate">{epic.title}</span>
        </div>
      )}
      <div className="flex min-w-0 items-start gap-2">
        {check}
        <p
          className={cn(
            "min-w-0 flex-1 text-[15px] leading-[1.3] font-semibold text-pretty",
            !epic && "pe-6",
            done && "text-muted-foreground font-medium",
          )}
        >
          {story && !epic && (
            <Bookmark
              className="text-muted-foreground me-1.5 inline size-3.5 align-[-2px]"
              aria-label="Story"
            />
          )}
          <TaskTitle>{task.title}</TaskTitle>
        </p>
      </div>

      {!done && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          {priority && (
            <span className={cn("font-bold", priority.className)}>
              {priority.label}
              <span className="sr-only"> priority</span>
            </span>
          )}
          {task.labels.slice(0, 3).map(({ label }) => (
            <span
              key={label.id}
              className="inline-flex min-w-0 items-center gap-1.5 font-semibold"
              style={{ color: label.color }}
            >
              <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-current" />
              <span className="truncate">{label.name}</span>
            </span>
          ))}
        </div>
      )}

      {/* The date, then the one button beside the faces in the right corner. */}
      <div className="text-muted-foreground flex min-w-0 items-center gap-2 text-[13px]">
        {late > 0 ? (
          <span className="bg-tint-danger text-tint-danger-foreground inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] font-bold whitespace-nowrap">
            <Clock className="size-3.5" aria-hidden="true" />
            {late}d late
          </span>
        ) : (
          <DueLabel dueDate={task.dueDate} todayKey={todayKey} done={done} />
        )}
        <span className="ms-auto flex min-w-0 items-center gap-2">
          {ambient}
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
        </span>
      </div>
    </div>
  );
}
