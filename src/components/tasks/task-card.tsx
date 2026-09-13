import { CalendarClock, ListChecks } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { formatDueDate, initials, isOverdue } from "./utils";

export interface TaskCardData {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate: Date | null;
  assignees: { user: { id: string; name: string | null; email: string; image: string | null } }[];
  labels: { label: { id: string; name: string; color: string } }[];
  subtasks: { id: string; status: string }[];
}

/**
 * Plain presentational card — no button/interactive role of its own. When
 * used inside a sortable list, the wrapper (e.g. SortableTaskCard) owns
 * click/focus/drag on a single element; a nested <button> here would create
 * two competing focusable/interactive elements for the same card.
 */
export function TaskCard({ task }: { task: TaskCardData }) {
  const overdue = isOverdue(task.dueDate, task.status);
  const completedSubtasks = task.subtasks.filter((s) => s.status === "COMPLETED").length;

  return (
    <div className="bg-card w-full space-y-2 rounded-md border p-3 text-sm shadow-sm">
      <p className="font-medium">{task.title}</p>

      {task.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.labels.map(({ label }) => (
            <Badge
              key={label.id}
              style={{ backgroundColor: label.color, color: "white" }}
              className="border-0"
            >
              {label.name}
            </Badge>
          ))}
        </div>
      )}

      <div className="text-muted-foreground flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {task.dueDate && (
            <span
              className={cn("flex items-center gap-1", overdue && "text-destructive font-medium")}
            >
              <CalendarClock className="size-3.5" aria-hidden="true" />
              {formatDueDate(task.dueDate)}
            </span>
          )}
          {task.subtasks.length > 0 && (
            <span className="flex items-center gap-1">
              <ListChecks className="size-3.5" aria-hidden="true" />
              {completedSubtasks}/{task.subtasks.length}
            </span>
          )}
        </div>

        {task.assignees.length > 0 && (
          <div className="flex -space-x-2">
            {task.assignees.slice(0, 3).map(({ user }) => (
              <Avatar key={user.id} className="border-background size-6 border-2">
                {user.image && <AvatarImage src={user.image} alt="" />}
                <AvatarFallback className="text-[10px]">
                  {initials(user.name ?? user.email)}
                </AvatarFallback>
              </Avatar>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
