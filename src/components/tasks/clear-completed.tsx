"use client";

import { BrushCleaning } from "@/components/icons";
import { useTransition } from "react";

import { bulkDelete, restoreTask } from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { canEditTask } from "@/lib/tasks/access";
import { cn } from "@/lib/utils";

import { accessSubjectOf, useTasks } from "./tasks-context";
import type { TaskItem } from "./types";

/**
 * The icon button in the corner of a Completed section: moves the finished
 * tasks the viewer may delete to the trash (their subtasks with them), with
 * Undo on the toast. Tasks they can't edit stay where they are.
 */
export function ClearCompletedButton({
  tasks,
  className,
}: {
  tasks: TaskItem[];
  className?: string;
}) {
  const { org, actor } = useTasks();
  const [isPending, startTransition] = useTransition();
  const ids = tasks
    .filter((t) => t.status === "COMPLETED" && canEditTask(actor, accessSubjectOf(t)))
    .map((t) => t.id);
  if (ids.length === 0) return null;
  const n = ids.length;
  const label = `Clear ${n} completed task${n === 1 ? "" : "s"}`;

  function clear() {
    startTransition(async () => {
      const result = await bulkDelete(org.id, ids);
      if (result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      toast({
        title: `Cleared ${n} completed task${n === 1 ? "" : "s"}`,
        tone: "success",
        action: {
          label: "Undo",
          run: async () => {
            for (const id of ids) {
              const undone = await restoreTask(org.id, id);
              if (undone.error) return undone.error;
            }
          },
        },
      });
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={isPending}
      onClick={clear}
      className={cn("text-muted-foreground hover:text-foreground", className)}
    >
      <BrushCleaning className="size-4" aria-hidden="true" />
    </Button>
  );
}
