"use client";

import { CalendarPlus, UserPlus } from "@/components/icons";
import { useCallback, useOptimistic, useTransition } from "react";

import { updateTask } from "@/app/app/[orgSlug]/tasks/actions";
import { UserAvatar } from "@/components/user-avatar";
import { dueDateKey, fromDateKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

import { useConfirmFlagged } from "./prompts";
import { DueLabel } from "./task-badges";
import { DueField, OwnerField } from "./task-fields";
import { useTasks } from "./tasks-context";

/**
 * A card's or row's own date and owner, changed where you see them: click
 * the date to pick another (the same menu as the task form, with its
 * T / M / F / W keys and "next thu"), click the face to hand it to someone.
 * Each saves the moment it changes; nothing to open, nothing to Save.
 *
 * Both sit inside things that click, drag and open on Enter (a board card,
 * a list row), so they keep their own pointer and key events.
 */

const keep = {
  onClick: (e: React.SyntheticEvent) => e.stopPropagation(),
  onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

/** Saves one field of a task; an above-level owner is confirmed first, as on the form. */
export function useTaskPatch() {
  const { org, announce } = useTasks();
  const [confirmEl, confirmFlagged] = useConfirmFlagged();
  const patch = useCallback(
    async (taskId: string, input: Record<string, unknown>) => {
      let result = await updateTask(org.id, taskId, input);
      if ("confirm" in result && result.confirm) {
        const names = result.confirm.flagged.map((u) => u.name ?? "Someone");
        if (!(await confirmFlagged(names))) return false;
        result = await updateTask(org.id, taskId, { ...input, confirmFlagged: true });
      }
      if (result.error) {
        announce(result.error);
        return false;
      }
      return true;
    },
    [org.id, announce, confirmFlagged],
  );
  return [confirmEl, patch] as const;
}

export function QuickDue({
  task,
  done = false,
  disabled = false,
  open,
  onOpenChange,
  className,
}: {
  task: { id: string; title: string; dueDate: Date | null };
  done?: boolean;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const { org } = useTasks();
  const [confirmEl, patch] = useTaskPatch();
  const key = task.dueDate ? dueDateKey(task.dueDate) : "";
  const [value, setOptimistic] = useOptimistic(key);
  const [, startTransition] = useTransition();

  if (disabled) return <DueLabel dueDate={task.dueDate} todayKey={org.todayKey} done={done} />;
  return (
    <span className="contents" {...keep}>
      {confirmEl}
      <DueField
        value={value}
        open={open}
        onOpenChange={onOpenChange}
        onChange={(next) =>
          startTransition(async () => {
            setOptimistic(next);
            await patch(task.id, { dueDate: next || null });
          })
        }
        trigger={
          <button
            type="button"
            aria-label={value ? `Due date of ${task.title}` : `Add a due date to ${task.title}`}
            className={cn(
              "hover:bg-muted focus-visible:outline-foreground -mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors focus-visible:outline-2",
              !value &&
                "text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100",
              className,
            )}
          >
            {value ? (
              <DueLabel dueDate={fromDateKey(value)} todayKey={org.todayKey} done={done} />
            ) : (
              <>
                <CalendarPlus className="size-3.5" aria-hidden="true" />
                Date
              </>
            )}
          </button>
        }
      />
    </span>
  );
}

export function QuickOwner({
  task,
  disabled = false,
  open,
  onOpenChange,
  size = "sm",
  className,
}: {
  task: {
    id: string;
    title: string;
    ownerId: string | null;
    owner: { id: string; name: string | null; image?: string | null } | null;
  };
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: "xs" | "sm";
  className?: string;
}) {
  const { memberById } = useTasks();
  const [confirmEl, patch] = useTaskPatch();
  const [ownerId, setOptimistic] = useOptimistic(task.ownerId);
  const [, startTransition] = useTransition();
  const owner = ownerId ? (memberById.get(ownerId) ?? task.owner) : null;

  if (disabled) {
    return owner ? <UserAvatar user={owner} size={size} className={className} /> : null;
  }
  return (
    <span className="contents" {...keep}>
      {confirmEl}
      <OwnerField
        value={ownerId}
        open={open}
        onOpenChange={onOpenChange}
        onChange={(next) =>
          startTransition(async () => {
            setOptimistic(next);
            await patch(task.id, { ownerId: next });
          })
        }
        trigger={
          <button
            type="button"
            aria-label={
              owner
                ? `Owner of ${task.title}: ${owner.name ?? "member"}`
                : `Give ${task.title} an owner`
            }
            className={cn(
              "focus-visible:outline-foreground grid shrink-0 place-items-center rounded-full transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95",
              className,
            )}
          >
            {owner ? (
              <UserAvatar user={owner} size={size} />
            ) : (
              <span
                className={cn(
                  "text-muted-foreground border-border hover:text-foreground hover:border-foreground grid place-items-center rounded-full border border-dashed transition-colors",
                  size === "sm" ? "size-6" : "size-5",
                )}
              >
                <UserPlus className="size-3" aria-hidden="true" />
              </span>
            )}
          </button>
        }
      />
    </span>
  );
}
