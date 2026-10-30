"use client";

import { ExternalLink, Link2, Trash2 } from "@/components/icons";

import { deleteTask, restoreTask } from "@/app/app/[orgSlug]/tasks/actions";
import { ItemMenu } from "@/components/item-menu";
import { toast, undoable } from "@/components/ui/toaster";

import { useTasks } from "./tasks-context";

/**
 * The "…" on a task row or board card: open its page, copy its link, delete
 * it. Clicking the card itself opens it, so that isn't repeated here.
 * Deleting doesn't ask: it goes at once, subtasks with it, and Undo brings
 * the lot back. It needs the same right as editing; the action checks again.
 */
export function TaskItemMenu({
  task,
  editable,
  onOpen,
  className,
}: {
  task: { id: string; title: string; subtaskCount: number };
  editable: boolean;
  onOpen: () => void;
  className?: string;
}) {
  const { org } = useTasks();
  void onOpen;
  const href = `/app/${org.slug}/tasks/${task.id}`;

  const remove = () =>
    undoable({
      title: task.subtaskCount > 0 ? `Deleted with ${task.subtaskCount} subtasks` : "Deleted",
      run: async () => (await deleteTask(org.id, task.id)).error,
      undo: async () => (await restoreTask(org.id, task.id)).error,
    });

  return (
    <ItemMenu
      label={`Actions for ${task.title}`}
      className={className}
      items={[
        { label: "Open page", icon: ExternalLink, href },
        {
          label: "Copy link",
          icon: Link2,
          onSelect: () =>
            void navigator.clipboard
              ?.writeText(`${window.location.origin}${href}`)
              .then(() => toast({ title: "Copied", tone: "success", duration: 3_000 }))
              .catch(() => toast({ title: "Couldn't copy the link", tone: "error" })),
        },
        editable && {
          label: "Delete",
          icon: Trash2,
          destructive: true,
          onSelect: () => void remove(),
        },
      ]}
    />
  );
}
