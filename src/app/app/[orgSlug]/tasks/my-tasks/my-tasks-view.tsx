"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { TaskDetailDialog } from "@/components/tasks/task-detail-dialog";
import { TaskRow } from "@/components/tasks/task-row";
import { useTasks } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { dueBucket, dueDateKey, type DueBucket } from "@/lib/tasks/dates";

/**
 * My Tasks: everything I own or am involved in, grouped Overdue / Today /
 * This week / Later / No date, with Blocked on its own, and what I finished
 * in the last 7 days.
 */

const GROUPS: { key: DueBucket | "blocked"; title: string }[] = [
  { key: "overdue", title: "Overdue" },
  { key: "blocked", title: "Blocked" },
  { key: "today", title: "Today" },
  { key: "thisWeek", title: "This week" },
  { key: "later", title: "Later" },
  { key: "none", title: "No date" },
];

export function MyTasksView({
  open,
  completed,
  hasMore,
  moreHref,
}: {
  open: TaskItem[];
  completed: TaskItem[];
  hasMore: boolean;
  moreHref: string;
}) {
  const { org } = useTasks();
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const all = useMemo(() => [...open, ...completed], [open, completed]);
  const openTask = openTaskId ? (all.find((t) => t.id === openTaskId) ?? null) : null;

  const groups = useMemo(() => {
    const out = new Map<string, TaskItem[]>(GROUPS.map((g) => [g.key, []]));
    for (const t of open) {
      const key = t.status === "BLOCKED" ? "blocked" : dueBucket(t.dueDate ? dueDateKey(t.dueDate) : null, org.todayKey);
      out.get(key)!.push(t);
    }
    return out;
  }, [open, org.todayKey]);

  if (open.length === 0 && completed.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing on your plate"
        description="Tasks you own or are involved in show up here, grouped by when they're due."
      />
    );
  }

  return (
    <div className="space-y-6">
      {GROUPS.map((g) => {
        const tasks = groups.get(g.key) ?? [];
        if (tasks.length === 0) return null;
        return (
          <section key={g.key} aria-labelledby={`mine-${g.key}`}>
            <h2
              id={`mine-${g.key}`}
              className={
                g.key === "overdue" || g.key === "blocked"
                  ? "text-destructive mb-2 text-sm font-semibold"
                  : "mb-2 text-sm font-semibold"
              }
            >
              {g.title} <span className="text-muted-foreground font-normal">({tasks.length})</span>
            </h2>
            <ul className="divide-y rounded-lg border">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} onOpen={setOpenTaskId} />
              ))}
            </ul>
          </section>
        );
      })}
      {hasMore && (
        <Link href={moreHref} className="text-muted-foreground hover:text-foreground block text-sm">
          Show more open tasks
        </Link>
      )}
      {completed.length > 0 && (
        <section aria-labelledby="mine-done">
          <h2 id="mine-done" className="text-muted-foreground mb-2 text-sm font-semibold">
            Completed in the last 7 days ({completed.length})
          </h2>
          <ul className="divide-y rounded-lg border">
            {completed.map((t) => (
              <TaskRow key={t.id} task={t} onOpen={setOpenTaskId} />
            ))}
          </ul>
        </section>
      )}
      <TaskDetailDialog open={openTaskId !== null} onOpenChange={(o) => !o && setOpenTaskId(null)} task={openTask} />
    </div>
  );
}
