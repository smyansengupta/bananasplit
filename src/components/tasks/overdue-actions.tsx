"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addTaskComment, updateTask } from "@/app/app/[orgSlug]/tasks/actions";
import { Bell, CalendarClock } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { runAction } from "@/lib/run-action";
import { addDaysToKey } from "@/lib/tasks/dates";
import { mentionToken } from "@/lib/tasks/mentions";

/**
 * What to do about a late task, wherever one shows (Home's My tasks and
 * Waiting on others, a report's Overdue and stale): Nudge whoever owns it,
 * or Push back its due date. A nudge is a comment on the task that mentions
 * them, so it reaches them the way any mention does and stays on the task
 * for everyone to see. Pushing back is an ordinary due-date edit, with the
 * task page's permissions.
 */

const NUDGE_TEXT = "Checking in on this. Any update?";

/** What Follow up says: for something you're waiting on that isn't late yet. */
export const FOLLOW_UP_TEXT = "Following up on this. Where does it stand?";

export function NudgeButton({
  orgId,
  taskId,
  person,
  text = NUDGE_TEXT,
  label = "Nudge",
  size = "sm",
}: {
  orgId: string;
  taskId: string;
  person: { id: string; name: string | null };
  text?: string;
  /** "Nudge" for something late, "Follow up" for something that isn't yet. */
  label?: "Nudge" | "Follow up";
  /** icon-sm: just the bell, beside Push back's icon on a task row. */
  size?: "sm" | "icon-sm";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(text);
  const [pending, start] = useTransition();
  const who = person.name?.trim().split(/\s+/)[0] ?? "them";
  const send = () => {
    const body = message.trim();
    if (!body || pending) return;
    start(async () => {
      const result = await runAction(() =>
        addTaskComment(
          orgId,
          taskId,
          `${mentionToken(person.name ?? "member", person.id)} ${body}`,
          label === "Nudge" ? "nudge" : "follow-up",
        ),
      );
      if (result === undefined) return;
      if (result && "error" in result && result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      setOpen(false);
      toast({ title: label === "Nudge" ? `Nudged ${who}` : `Followed up with ${who}` });
      router.refresh();
    });
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={size}
          aria-label={label === "Nudge" ? `Nudge ${who}` : `Follow up with ${who}`}
          title={size === "icon-sm" ? label : undefined}
        >
          {size === "icon-sm" ? <Bell aria-hidden="true" /> : label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <form
          className="space-y-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <p className="text-muted-foreground text-[13px]">
            Comments on the task and mentions {who}.
          </p>
          <Textarea
            autoFocus
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-label={`Message to ${who}`}
          />
          <Button type="submit" size="sm" className="w-full" disabled={!message.trim() || pending}>
            Send
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday after today. */
function nextMonday(today: string): string {
  const [y, m, d] = today.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDaysToKey(today, (8 - dow) % 7 || 7);
}

/** Push back a late task's due date: tomorrow, in three days, next Monday or in a week. */
export function PushBackButton({
  orgId,
  taskId,
  title,
  size = "sm",
  triggerClassName,
}: {
  orgId: string;
  taskId: string;
  title: string;
  size?: "sm" | "icon-sm";
  /** A plain trigger with these classes, for a card with its own colours (Up next). */
  triggerClassName?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = todayKey();
  // Next Monday is left out when it's tomorrow or a week away (another choice already).
  const monday = nextMonday(today);
  const choices = [
    { label: "Tomorrow", key: addDaysToKey(today, 1) },
    { label: "In 3 days", key: addDaysToKey(today, 3) },
    { label: "Next Monday", key: monday },
    { label: "In a week", key: addDaysToKey(today, 7) },
  ].filter(
    (c) =>
      c.label !== "Next Monday" ||
      (monday !== addDaysToKey(today, 1) && monday !== addDaysToKey(today, 7)),
  );
  const push = (key: string, label: string) =>
    start(async () => {
      const result = await runAction(() => updateTask(orgId, taskId, { dueDate: key }));
      if (result === undefined) return;
      if (result && "error" in result && result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      toast({
        title: `${title} is now due ${label.replace(/^(Tomorrow|In|Next)\b/, (w) => w.toLowerCase())}`,
      });
      router.refresh();
    });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {triggerClassName ? (
          <button
            type="button"
            disabled={pending}
            aria-label={`Push back ${title}`}
            title="Push back the due date"
            className={triggerClassName}
          >
            <CalendarClock className="size-3.5" aria-hidden="true" />
            Push back
          </button>
        ) : (
          <Button
            variant="outline"
            size={size}
            disabled={pending}
            aria-label={`Push back ${title}`}
            title="Push back the due date"
          >
            <CalendarClock aria-hidden="true" />
            {size === "sm" && "Push back"}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map((c) => (
          <DropdownMenuItem key={c.label} onSelect={() => push(c.key, c.label)}>
            {c.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
