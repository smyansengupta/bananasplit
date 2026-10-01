"use client";

import { ExternalLink, Link2, PanelRightOpen, Trash2 } from "lucide-react";

import { deleteTask, restoreTask } from "@/app/app/[orgSlug]/tasks/actions";
import { ItemMenu } from "@/components/item-menu";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/ui/toaster";

import { useTasks } from "./tasks-context";

/**
 * The "…" on a task row or board card: open it, open its page, copy its
 * link, delete it (asked first, with Undo). Deleting needs the same right
 * as editing; the action checks again.
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
  const [confirmEl, confirm] = useConfirm();
  const href = `/app/${org.slug}/tasks/${task.id}`;

  async function remove() {
    const n = task.subtaskCount;
    const ok = await confirm({
      title: `Delete “${task.title}”?`,
      description:
        n > 0
          ? `Its ${n} subtask${n === 1 ? "" : "s"} go${n === 1 ? "es" : ""} with it. You can undo this right after.`
          : "You can undo this right after.",
      confirmLabel: "Delete task",
      run: async () => (await deleteTask(org.id, task.id)).error,
    });
    if (!ok) return;
    toast({
      title: "Task deleted",
      description: task.title,
      action: { label: "Undo", run: async () => (await restoreTask(org.id, task.id)).error },
    });
  }

  return (
    <>
      <ItemMenu
        label={`Actions for ${task.title}`}
        className={className}
        items={[
          { label: "Open", icon: PanelRightOpen, onSelect: onOpen },
          { label: "Open page", icon: ExternalLink, href },
          {
            label: "Copy link",
            icon: Link2,
            onSelect: () =>
              void navigator.clipboard
                ?.writeText(`${window.location.origin}${href}`)
                .then(() => toast({ title: "Link copied", tone: "success", duration: 3_000 }))
                .catch(() => toast({ title: "Couldn't copy the link", tone: "error" })),
          },
          editable && { label: "Delete", icon: Trash2, destructive: true, onSelect: () => void remove() },
        ]}
      />
      {/* The dialog is portalled, but its events still bubble to the card it sits in. */}
      <span
        className="contents"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {confirmEl}
      </span>
    </>
  );
}
