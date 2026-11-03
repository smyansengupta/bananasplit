"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  addTaskComment,
  deleteTask,
  keepTask,
  restoreTask,
  selfAssignTask,
  setTaskStatus,
  updateTask,
} from "@/app/app/[orgSlug]/tasks/actions";
import {
  Bell,
  CalendarClock,
  CircleCheck,
  CircleQuestionMark,
  LockOpen,
  MessageCircle,
  UserPlus,
  Users,
} from "@/components/icons";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/toaster";
import { UserAvatar } from "@/components/user-avatar";
import { AMBIENT_BUTTON } from "@/components/ambient/ambient-button";
import { TaskStatus } from "@/generated/prisma/enums";
import {
  nextMondayKey,
  taskAmbient,
  type TaskAmbient,
  type TaskAmbientKind,
} from "@/lib/ambient/tasks";
import { runAction } from "@/lib/run-action";
import { canEditTask } from "@/lib/tasks/access";
import { relationFor } from "@/lib/tasks/assignment";
import { addDaysToKey } from "@/lib/tasks/dates";
import { mentionToken } from "@/lib/tasks/mentions";
import { cn } from "@/lib/utils";

import { AmbientMenu, AmbientMessage, AmbientRow, type AmbientItem } from "./ambient-pills";
import { FOLLOW_UP_TEXT } from "./overdue-actions";
import { useConfirmFlagged } from "./prompts";
import { accessSubjectOf, useTasks } from "./tasks-context";
import type { TaskItem } from "./types";

/**
 * A task's ambient buttons (Buttons2: Tasks, epics and projects), wherever
 * it shows: its row, its board card, its page. src/lib/ambient/tasks.ts
 * decides which; this does each job in place. The first two show.
 */

const NUDGE_TEXT = "Checking in on this. Any update?";
const UNBLOCK_TEXT = "This has been blocked a while. What would unblock it?";

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "them";
}

export function TaskAmbientActions({
  task,
  page = false,
  only,
  why = false,
  short = false,
  className,
  align,
}: {
  task: TaskItem;
  /** The task page (Follow up shows there). */
  page?: boolean;
  /** A board card: "Nudge" without the name (their face is right beside it). */
  short?: boolean;
  /** Just these kinds. */
  only?: readonly TaskAmbientKind[];
  why?: boolean;
  className?: string;
  align?: "start" | "end";
}) {
  const items = useTaskAmbientItems(task, { page, only, short });
  return <AmbientRow items={items} why={why} className={className} align={align} />;
}

/** The task's ambient things, as AmbientRow items (the first reason is its why line). */
export function useTaskAmbientItems(
  task: TaskItem,
  {
    page = false,
    only,
    short = false,
  }: { page?: boolean; only?: readonly TaskAmbientKind[]; short?: boolean } = {},
): AmbientItem[] {
  const { org, viewer, actor, memberById } = useTasks();
  const editable = canEditTask(actor, accessSubjectOf(task));
  const found = useMemo(
    () =>
      taskAmbient(task, {
        viewerId: viewer.userId,
        todayKey: org.todayKey,
        now: new Date(),
        editable,
        page,
      }).filter((a) => !only || only.includes(a.kind)),
    [task, viewer.userId, org.todayKey, editable, page, only],
  );
  const nameOf = (id: string | undefined) =>
    (id && (memberById.get(id)?.name ?? (id === task.ownerId ? task.owner?.name : null))) ||
    (id === task.createdById ? task.createdBy?.name : null) ||
    null;
  return found.map((a) => itemFor(a, task, org.id, org.todayKey, nameOf(a.personId), short));
}

/** The ask as a comment that mentions them: it lands in their Inbox, saying what it is. */
function comment(
  orgId: string,
  taskId: string,
  personId: string,
  name: string | null,
  ask: "nudge" | "unblock" | "follow-up",
) {
  return (body: string) =>
    addTaskComment(orgId, taskId, `${mentionToken(name ?? "member", personId)} ${body}`, ask);
}

function itemFor(
  a: TaskAmbient,
  task: TaskItem,
  orgId: string,
  todayKey: string,
  personName: string | null,
  short = false,
): AmbientItem {
  const who = firstName(personName);
  const base = { key: a.kind, reason: a.reason };
  switch (a.kind) {
    case "close-epic":
    case "mark-done":
      return {
        ...base,
        action: {
          key: a.kind,
          label: a.kind === "close-epic" ? "Close the epic" : "Mark done",
          icon: CircleCheck,
          reason: a.reason,
          tone: "solid",
          ariaLabel: `${a.kind === "close-epic" ? "Close" : "Mark done"} ${task.title}`,
          run: () => setTaskStatus(orgId, task.id, TaskStatus.COMPLETED),
          done: `Done: ${task.title}`,
        },
      };
    case "push": {
      const push = (key: string) => () => updateTask(orgId, task.id, { dueDate: key });
      const monday = nextMondayKey(todayKey);
      const tomorrow = addDaysToKey(todayKey, 1);
      return {
        ...base,
        node: (
          <AmbientMenu
            label="Push back"
            icon={CalendarClock}
            reason={a.reason}
            ariaLabel={`Push back ${task.title}`}
            choices={[
              { label: "Tomorrow", run: push(tomorrow), done: `${task.title} is due tomorrow` },
              ...(monday !== tomorrow
                ? [{ label: "Next Monday", run: push(monday), done: `${task.title} is due Monday` }]
                : []),
              {
                label: "In a week",
                run: push(addDaysToKey(todayKey, 7)),
                done: `${task.title} is due in a week`,
              },
            ]}
          />
        ),
      };
    }
    case "nudge":
    case "follow-up":
    case "unblock": {
      const label =
        a.kind === "nudge"
          ? short
            ? "Nudge"
            : `Nudge ${who}`
          : a.kind === "follow-up"
            ? "Follow up"
            : "Ask to unblock";
      const text =
        a.kind === "nudge" ? NUDGE_TEXT : a.kind === "follow-up" ? FOLLOW_UP_TEXT : UNBLOCK_TEXT;
      return {
        ...base,
        node: (
          <AmbientMessage
            label={label}
            reason={a.reason}
            ariaLabel={`${a.kind === "nudge" ? `Nudge ${who}` : label}: ${task.title}`}
            hint={`Comments on the task and mentions ${who}.`}
            text={text}
            icon={a.kind === "nudge" ? Bell : a.kind === "follow-up" ? MessageCircle : LockOpen}
            send={comment(orgId, task.id, a.personId!, personName, a.kind)}
            done={
              a.kind === "nudge"
                ? `Nudged ${who}`
                : a.kind === "follow-up"
                  ? `Followed up with ${who}`
                  : `Asked ${who}`
            }
          />
        ),
      };
    }
    case "take":
      return {
        ...base,
        action: {
          key: "take",
          label: "Take it",
          icon: UserPlus,
          reason: a.reason,
          ariaLabel: `Take ${task.title}`,
          run: () => selfAssignTask(orgId, task.id, "claim"),
          done: "It's yours",
        },
      };
    case "assign":
      return { ...base, node: <AssignPill task={task} reason={a.reason} /> };
    case "still-needed":
      return {
        ...base,
        node: (
          <AmbientMenu
            label="Still needed?"
            icon={CircleQuestionMark}
            reason={a.reason}
            ariaLabel={`Is ${task.title} still needed?`}
            choices={[
              { label: "Keep it", run: () => keepTask(orgId, task.id), done: "Kept" },
              {
                // There's no archive for tasks: this deletes it, with Undo.
                label: "No, delete it",
                run: async () => {
                  const result = await deleteTask(orgId, task.id);
                  if (!result.error) {
                    toast({
                      title: `Deleted ${task.title}`,
                      action: {
                        label: "Undo",
                        run: async () => (await restoreTask(orgId, task.id)).error,
                      },
                    });
                  }
                  return result;
                },
              },
            ]}
          />
        ),
      };
  }
}

/** Assign: pick who owns it, in a popover (an above-your-level pick asks first). */
function AssignPill({ task, reason }: { task: TaskItem; reason: string }) {
  const { org, viewer, members } = useTasks();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [gone, setGone] = useState(false);
  const [pending, start] = useTransition();
  const [confirmElement, confirmFlagged] = useConfirmFlagged();
  if (gone) return null;
  const q = query.trim().toLowerCase();
  const shown = members.filter((m) => !q || (m.name ?? "").toLowerCase().includes(q)).slice(0, 8);

  const assign = (userId: string, name: string | null) =>
    start(async () => {
      let confirmFlaggedOk = false;
      if (relationFor(viewer.chart, userId) === "ABOVE") {
        confirmFlaggedOk = await confirmFlagged([name ?? "This person"]);
        if (!confirmFlaggedOk) return;
      }
      const result = await runAction(() =>
        updateTask(org.id, task.id, { ownerId: userId, confirmFlagged: confirmFlaggedOk }),
      );
      if (result === undefined) return;
      if (result.error) {
        toast({ title: result.error, tone: "error" });
        return;
      }
      setOpen(false);
      setGone(true);
      toast({ title: `${firstName(name)} owns it now` });
      router.refresh();
    });

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <span className="inline-flex" onClick={stop} onPointerDown={stop} onKeyDown={stop}>
      {confirmElement}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={reason}
            aria-label={`Assign ${task.title}`}
            className={cn(
              AMBIENT_BUTTON,
              "text-foreground bg-transparent shadow-[inset_0_0_0_1px_color-mix(in_oklab,currentColor_28%,transparent)] hover:bg-current/8",
            )}
          >
            <Users aria-hidden="true" />
            Assign
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-1.5">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Who owns it?"
            aria-label="Find a member"
            className="mb-1 h-8"
          />
          <ul role="listbox" aria-label="Members">
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => assign(m.id, m.name)}
                  className="hover:bg-muted rounded-field flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm"
                >
                  <UserAvatar user={m} size="xs" />
                  <span className="min-w-0 flex-1 truncate">
                    {m.id === viewer.userId ? "You" : (m.name ?? "Member")}
                  </span>
                </button>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="text-muted-foreground px-2 py-1.5 text-sm">Nobody by that name</li>
            )}
          </ul>
        </PopoverContent>
      </Popover>
    </span>
  );
}
