"use client";

import { CalendarClock, Plus } from "@/components/icons";
import { useMemo, useRef, useState, useTransition } from "react";

import { createTask } from "@/app/app/[orgSlug]/tasks/actions";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import type { TaskStatus } from "@/generated/prisma/enums";
import { parseQuickAdd } from "@/lib/tasks/quick-add";
import { cn } from "@/lib/utils";

import { useConfirmFlagged } from "./prompts";
import { HashTagHint } from "./tag-menu";
import { longDue } from "./task-fields";
import { useTasks } from "./tasks-context";
import { useHashTags } from "./use-hash-tags";

/**
 * The quick add (List, the top of each board column): one line is a whole
 * task. "Order bolts @priya fri #venue" makes "Order bolts", owned by
 * Priya, due Friday, tagged venue (src/lib/tasks/quick-add.ts). Enter
 * creates it and keeps the line ready for the next one, so five tasks are
 * five lines, not five trips through a form. Under the line it says what it
 * understood, before you press Enter.
 *
 * With no @, the task is yours (as New task is). `defaults` put it in the
 * column's status or the epic in view.
 */
export function QuickAddField({
  defaults,
  placeholder = "Add a task",
  compact = false,
  autoFocus = false,
  onEscape,
  className,
}: {
  defaults?: { status?: TaskStatus; parentTaskId?: string | null };
  placeholder?: string;
  /** The board column's smaller line. */
  compact?: boolean;
  autoFocus?: boolean;
  /** Esc on an empty line (a board column closes it). */
  onEscape?: () => void;
  className?: string;
}) {
  const { org, viewer, members, memberById, announce } = useTasks();
  const hashTags = useHashTags();
  const [confirmEl, confirmFlagged] = useConfirmFlagged();
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const parsed = useMemo(
    () => parseQuickAdd(text, org.todayKey, members),
    [text, org.todayKey, members],
  );
  const owner = parsed.ownerId ? memberById.get(parsed.ownerId) : undefined;

  function submit() {
    if (!text.trim() || isPending) return;
    startTransition(async () => {
      const resolved = await hashTags.resolve(parsed.title);
      if (resolved.error) announce(resolved.error);
      const input0 = {
        title: resolved.title,
        labelIds: resolved.labelIds,
        parentTaskId: defaults?.parentTaskId ?? null,
        status: defaults?.status,
        ownerId: parsed.ownerId ?? viewer.userId,
        dueDate: parsed.dueKey,
      };
      let result = await createTask(org.id, input0);
      if ("confirm" in result && result.confirm) {
        const names = result.confirm.flagged.map((u) => u.name ?? "Someone");
        if (!(await confirmFlagged(names))) return;
        result = await createTask(org.id, { ...input0, confirmFlagged: true });
      }
      if (result.error) {
        announce(result.error);
        return;
      }
      setText("");
      input.current?.focus();
    });
  }

  const understood = Boolean(owner || parsed.dueKey);
  return (
    <div className={cn("space-y-1.5", className)}>
      {confirmEl}
      <div
        className={cn(
          "bg-card edge focus-within:outline-foreground flex items-center gap-3 focus-within:outline-2 focus-within:outline-offset-2",
          compact ? "rounded-tile h-10 ps-3 pe-1" : "h-12 rounded-full ps-4 pe-1.5",
        )}
      >
        <Plus
          className={cn("text-muted-foreground shrink-0", compact ? "size-4" : "size-5")}
          aria-hidden="true"
        />
        <input
          ref={input}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            } else if (e.key === "Escape" && !text && onEscape) {
              e.preventDefault();
              onEscape();
            }
          }}
          maxLength={240}
          aria-label={placeholder}
          aria-describedby={understood ? `${org.id}-quick-understood` : undefined}
          placeholder={placeholder}
          className={cn(
            "placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent outline-none",
            compact ? "text-sm" : "text-[15px]",
          )}
        />
        {!compact && (
          <Button size="sm" onClick={submit} disabled={isPending || !text.trim()}>
            {isPending ? "Adding" : "Add"}
          </Button>
        )}
      </div>
      {understood && (
        <p
          id={`${org.id}-quick-understood`}
          aria-live="polite"
          className={cn(
            "text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs",
            compact ? "ps-3" : "ps-4",
          )}
        >
          {owner && (
            <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
              <UserAvatar user={owner} size="xs" />
              {owner.name ?? "Member"}
            </span>
          )}
          {parsed.dueKey && (
            <span className="text-foreground inline-flex items-center gap-1 font-medium">
              <CalendarClock className="size-3.5" aria-hidden="true" />
              {longDue(parsed.dueKey)}
            </span>
          )}
        </p>
      )}
      <HashTagHint title={text} className={compact ? "ps-3" : "ps-4"} />
    </div>
  );
}
