"use client";

import { CalendarDays, CheckSquare, ClipboardList, Wallet } from "@/components/icons";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { markAllNotificationsRead, markNotificationRead } from "@/app/app/notifications-actions";
import { rsvpToEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { setTaskStatus } from "@/app/app/[orgSlug]/tasks/actions";
import { TASK_PANEL } from "@/components/tasks/layout-ui";
import { TaskCheck } from "@/components/tasks/task-check";
import { Button } from "@/components/ui/button";
import { segmentedItem, segmentedTrack } from "@/components/ui/segmented";
import { toast, undoable } from "@/components/ui/toaster";
import type { RSVPStatus, TaskStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export type NeedRow =
  | { kind: "invite"; id: string; title: string; meta: string; href: string }
  | {
      kind: "task";
      id: string;
      title: string;
      meta: string;
      urgent: boolean;
      href: string;
      status: TaskStatus;
    }
  | { kind: "review"; id: string; title: string; meta: string; href: string };

export interface UpdateRow {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  when: string;
  unread: boolean;
}

/** One row of the Inbox, drawn like a row of the Tasks List. */
const ROW =
  "group hover:bg-muted/60 focus-within:bg-muted/60 rounded-field relative flex items-center gap-3 px-3 py-3 transition-colors duration-150 sm:gap-3.5 [li+&]:before:bg-border [li+&]:before:absolute [li+&]:before:inset-x-3 [li+&]:before:top-0 [li+&]:before:h-px";

/**
 * What needs you, each with its action on the row: answer an invite, finish
 * a task (with Undo), or go review requests. A row leaves the list once it's
 * dealt with.
 */
export function InboxNeeds({ orgId, rows }: { orgId: string; rows: NeedRow[] }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  const hide = (key: string) => setGone((s) => new Set(s).add(key));
  const show = (key: string) =>
    setGone((s) => {
      const next = new Set(s);
      next.delete(key);
      return next;
    });

  function answer(row: Extract<NeedRow, { kind: "invite" }>, rsvp: RSVPStatus) {
    const key = `invite:${row.id}`;
    hide(key);
    start(async () => {
      const result = await rsvpToEvent(orgId, row.id, rsvp);
      if (result.error) {
        show(key);
        toast({ title: result.error, tone: "error" });
        return;
      }
      toast({
        title: rsvp === "YES" ? "Going" : rsvp === "MAYBE" ? "Maybe" : "Not going",
        action: {
          label: "Undo",
          run: async () => {
            const back = await rsvpToEvent(orgId, row.id, "PENDING");
            if (back.error) return back.error;
            show(key);
            router.refresh();
          },
        },
      });
      router.refresh();
    });
  }

  function finish(row: Extract<NeedRow, { kind: "task" }>) {
    const key = `task:${row.id}`;
    hide(key);
    start(async () => {
      const ok = await undoable({
        title: "Done",
        run: async () => {
          const result = await setTaskStatus(orgId, row.id, "COMPLETED");
          return result.error ?? null;
        },
        undo: async () => {
          const back = await setTaskStatus(orgId, row.id, row.status);
          if (back.error) return back.error;
          show(key);
          router.refresh();
        },
      });
      if (!ok) show(key);
      else router.refresh();
    });
  }

  const shown = rows.filter((r) => !gone.has(`${r.kind}:${r.id}`));
  if (shown.length === 0) {
    return <p className="text-muted-foreground px-1 text-sm">All caught up.</p>;
  }

  return (
    <ul className={TASK_PANEL} aria-label="Needs you">
      {shown.map((row) => (
        <li key={`${row.kind}:${row.id}`} className={ROW}>
          {row.kind === "task" ? (
            <TaskCheck done={false} onToggle={() => finish(row)} label={`Complete ${row.title}`} />
          ) : (
            <span className="bg-muted text-muted-foreground grid size-[22px] shrink-0 place-items-center rounded-full">
              {row.kind === "invite" ? (
                <CalendarDays className="size-3.5" aria-hidden="true" />
              ) : row.id.startsWith("form-") ? (
                <ClipboardList className="size-3.5" aria-hidden="true" />
              ) : (
                <Wallet className="size-3.5" aria-hidden="true" />
              )}
            </span>
          )}
          <Link
            href={row.href}
            className="focus-visible:outline-foreground min-w-0 flex-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="block text-[15px] leading-snug font-medium break-words">
              {row.title}
            </span>
            <span
              className={cn(
                "mt-1 block text-[13px]",
                row.kind === "task" && row.urgent
                  ? "text-tint-danger-foreground font-medium"
                  : "text-muted-foreground",
              )}
            >
              {row.meta}
            </span>
          </Link>
          {row.kind === "invite" && (
            <span
              className={cn(segmentedTrack, "shrink-0")}
              role="group"
              aria-label={`Answer ${row.title}`}
            >
              {(
                [
                  ["YES", "Going"],
                  ["MAYBE", "Maybe"],
                  ["NO", "Can't go"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => answer(row, value)}
                  className={segmentedItem(false)}
                >
                  {label}
                </button>
              ))}
            </span>
          )}
          {row.kind === "review" && (
            <Button variant="outline" size="sm" asChild>
              <Link href={row.href}>Review</Link>
            </Button>
          )}
          {row.kind === "task" && (
            <CheckSquare
              className="text-muted-foreground size-4 shrink-0 max-sm:hidden"
              aria-hidden="true"
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** What happened, newest first. Opening one marks it read. */
export function InboxUpdates({ rows }: { rows: UpdateRow[] }) {
  const router = useRouter();
  const [read, setRead] = useState<Set<string>>(new Set());
  return (
    <ul className={TASK_PANEL} aria-label="Updates">
      {rows.map((row) => {
        const unread = row.unread && !read.has(row.id);
        const body = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                unread ? "bg-brand-accent" : "bg-transparent",
              )}
            />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-[15px] leading-snug break-words",
                  unread ? "font-semibold" : "font-medium",
                )}
              >
                {row.title}
              </span>
              {row.body && (
                <span className="text-muted-foreground mt-1 block text-[13px] break-words">
                  {row.body}
                </span>
              )}
            </span>
            <span className="text-muted-foreground shrink-0 text-[12px] whitespace-nowrap">
              {row.when}
              {unread && <span className="sr-only"> (unread)</span>}
            </span>
          </>
        );
        const markRead = () => {
          if (!unread) return;
          setRead((s) => new Set(s).add(row.id));
          void markNotificationRead(row.id).then(() => router.refresh());
        };
        return (
          <li key={row.id} className={cn(ROW, "items-start")}>
            {row.href ? (
              <Link
                href={row.href}
                onClick={markRead}
                className="focus-visible:outline-foreground flex min-w-0 flex-1 items-start gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {body}
              </Link>
            ) : (
              <button
                type="button"
                onClick={markRead}
                className="focus-visible:outline-foreground flex min-w-0 flex-1 items-start gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {body}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function MarkAllRead() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await markAllNotificationsRead();
          router.refresh();
        })
      }
    >
      Mark all read
    </Button>
  );
}
