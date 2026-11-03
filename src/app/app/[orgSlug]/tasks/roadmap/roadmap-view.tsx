"use client";

import { Layers } from "@/components/icons";
import { useOptimistic, useTransition, type CSSProperties } from "react";

import { AmbientActions } from "@/components/ambient/ambient-button";
import { EmptyState } from "@/components/empty-state";
import { useCompleteTask } from "@/components/tasks/quick-controls";
import { TaskCheck } from "@/components/tasks/task-check";
import { useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { TaskStatus } from "@/generated/prisma/enums";
import { epicReadyToClose } from "@/lib/ambient/tasks";
import { addDaysToKey, mondayOfKey } from "@/lib/tasks/dates";

import { setTaskStatus } from "../actions";
import { epicColor } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";
import type { RoadmapEpic } from "@/server/tasks/queries";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekLabel = (key: string) => MONTH.format(new Date(`${key}T00:00:00Z`));

/** Whole weeks from `a` to `b` (both Mondays). */
const weeksBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (7 * 864e5));

/**
 * Epics: every epic once, on a week timeline, the ones still going first.
 * The left of each row is the epic itself (the circle that finishes it, its
 * name in full, who owns it, what's open and what's late); the right is its
 * bar, from its start (its start date, else when it was made or its earliest
 * dated work) to its due date, with its progress filled in. This week's
 * column is marked. An epic with no due date runs two weeks, dashed.
 *
 * Clicking an epic opens it, the same as everywhere else; to see only its
 * work, pick it in the Epic filter. New epic is in the New task menu.
 */
export function RoadmapView({ epics }: { epics: RoadmapEpic[] }) {
  const { org, newTask } = useTasks();
  const ws = useWorkspace();

  if (epics.length === 0) {
    return (
      <div className="bg-card edge rounded-card">
        <EmptyState
          icon={Layers}
          title={ws.filterCount > 0 ? "No epics match" : "No epics yet"}
          action={
            ws.filterCount > 0 ? (
              <Button variant="outline" onClick={ws.clearFilters}>
                Clear filters
              </Button>
            ) : (
              <Button variant="create" onClick={() => newTask({ type: "EPIC" })}>
                New epic
              </Button>
            )
          }
        />
      </div>
    );
  }

  const thisWeek = mondayOfKey(org.todayKey);
  const starts = epics.map((e) => mondayOfKey(e.start));
  const ends = epics.map((e) => mondayOfKey(e.end ?? addDaysToKey(e.start, 13)));
  let first = [...starts, thisWeek].sort()[0]!;
  let last = [...ends, thisWeek].sort().at(-1)!;
  // Keep it readable: from four weeks back to half a year out, six weeks at least.
  if (weeksBetween(first, thisWeek) > 4) first = addDaysToKey(thisWeek, -28);
  if (weeksBetween(thisWeek, last) > 26) last = addDaysToKey(thisWeek, 26 * 7);
  while (weeksBetween(first, last) < 5) last = addDaysToKey(last, 7);
  const weeks = Array.from({ length: weeksBetween(first, last) + 1 }, (_, i) =>
    addDaysToKey(first, i * 7),
  );
  const nowCol = weeks.indexOf(thisWeek);
  const clampCol = (key: string) =>
    Math.max(0, Math.min(weeks.length - 1, weeksBetween(first, key)));

  // Epics still going first, the finished ones under them.
  const going = epics.filter((e) => e.status !== "COMPLETED");
  const finishedEpics = epics.filter((e) => e.status === "COMPLETED");
  const ordered = (
    [
      ["going", { name: "In progress", color: "var(--brand-accent)", epics: going }],
      ["done", { name: "Done", color: "var(--success)", epics: finishedEpics }],
    ] as const
  ).filter(([, g]) => g.epics.length > 0);

  const grid: CSSProperties = {
    gridTemplateColumns: `minmax(220px, 300px) repeat(${weeks.length}, minmax(56px, 1fr))`,
  };

  return (
    <div className="bg-card edge rounded-card overflow-x-auto p-4 sm:p-6">
      <div
        role="table"
        aria-label="Epics on a timeline"
        className="relative grid items-center gap-y-3"
        style={{ ...grid, minWidth: 300 + weeks.length * 60 }}
      >
        <div role="row" className="contents">
          <span
            role="columnheader"
            style={{ gridColumn: 1 }}
            className="border-border text-muted-foreground border-b pb-1.5 text-xs font-semibold"
          >
            Epic
          </span>
          {weeks.map((w, i) => (
            <span
              key={w}
              role="columnheader"
              style={{ gridColumn: i + 2 }}
              className={cn(
                "border-border border-b pb-1.5 text-xs font-semibold",
                i === nowCol ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {i === nowCol ? "This week" : weekLabel(w)}
            </span>
          ))}
        </div>

        {nowCol >= 0 && (
          <span
            aria-hidden="true"
            className="bg-brand-accent/10 rounded-field pointer-events-none absolute inset-y-0"
            style={{
              gridColumn: `${nowCol + 2} / ${nowCol + 3}`,
              gridRow: `1 / ${2 + ordered.reduce((n, [, g]) => n + 1 + g.epics.length, 0)}`,
            }}
          />
        )}

        {ordered.map(([key, g]) => (
          <div key={key} role="rowgroup" className="contents">
            <div role="row" className="contents">
              <span
                role="rowheader"
                className="text-muted-foreground col-span-full flex items-center gap-2 pt-3 text-[13px] font-semibold"
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ background: g.color }}
                />
                {g.name}
                <Badge variant="secondary" className="tabular-nums">
                  {g.epics.length}
                </Badge>
              </span>
            </div>
            {g.epics.map((e) => (
              <EpicRow
                key={e.id}
                epic={e}
                startCol={clampCol(mondayOfKey(e.start))}
                endCol={clampCol(mondayOfKey(e.end ?? addDaysToKey(e.start, 13)))}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EpicRow({
  epic: e,
  startCol,
  endCol,
}: {
  epic: RoadmapEpic;
  startCol: number;
  endCol: number;
}) {
  const { org, openTask } = useTasks();
  const complete = useCompleteTask();
  const [status, setOptimistic] = useOptimistic(e.status);
  const [, startTransition] = useTransition();
  const done = status === TaskStatus.COMPLETED;
  const pct = e.total > 0 ? Math.round((e.done / e.total) * 100) : 0;
  const finished = done || (e.total > 0 && e.done === e.total);
  const color = epicColor(e);
  const open = e.total - e.done;

  return (
    <div role="row" className="contents">
      <span role="cell" style={{ gridColumn: 1 }} className="flex min-w-0 items-start gap-2.5 pe-3">
        <TaskCheck
          size={18}
          done={done}
          label={done ? `Reopen ${e.title}` : `Mark ${e.title} done`}
          className="mt-0.5"
          onToggle={() =>
            startTransition(async () => {
              const next = done ? TaskStatus.NOT_STARTED : TaskStatus.COMPLETED;
              setOptimistic(next);
              await complete({ id: e.id, title: e.title, status: e.status }, next);
            })
          }
        />
        <span className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => openTask(e.id)}
            className="block text-left text-[13px] leading-snug font-semibold break-words underline-offset-4 hover:underline"
          >
            {e.title}
          </button>
          <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {e.total > 0 && <span className="tabular-nums">{open} open</span>}
            {e.overdue > 0 && (
              <span className="text-tint-danger-foreground font-semibold tabular-nums">
                {e.overdue} overdue
              </span>
            )}
          </span>
          {/* Every task in it is done: one click closes it. */}
          {epicReadyToClose({ status, done: e.done, total: e.total }) && (
            <AmbientActions
              why
              className="mt-1.5 items-start"
              actions={[
                {
                  key: "close-epic",
                  label: "Close the epic",
                  reason: "Every task in it is done",
                  tone: "solid",
                  ariaLabel: `Close ${e.title}`,
                  run: () => setTaskStatus(org.id, e.id, TaskStatus.COMPLETED),
                  done: `Closed ${e.title}`,
                },
              ]}
            />
          )}
        </span>
        {e.owner && <UserAvatar user={e.owner} size="xs" className="mt-0.5" />}
      </span>
      <span
        role="cell"
        style={
          {
            gridColumn: `${startCol + 2} / ${Math.max(endCol, startCol) + 3}`,
            "--lc": color,
          } as CSSProperties
        }
        className={cn(
          "relative z-[1] flex h-[30px] items-center overflow-hidden rounded-full border px-3 text-xs font-semibold",
          "border-[color-mix(in_oklab,var(--lc)_35%,transparent)] bg-[color-mix(in_oklab,var(--lc)_18%,var(--card))]",
          !e.end && "border-dashed",
        )}
      >
        <i
          aria-hidden="true"
          className="absolute inset-y-0 start-0 bg-[color-mix(in_oklab,var(--lc)_42%,var(--card))]"
          style={{ width: `${pct}%` }}
        />
        <span className="relative whitespace-nowrap">
          {finished ? "Done" : e.total > 0 ? `${pct}%, ${e.done} of ${e.total}` : "Empty"}
          {!e.end && ", no due date"}
        </span>
      </span>
    </div>
  );
}
