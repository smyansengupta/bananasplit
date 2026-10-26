"use client";

import { Layers } from "@/components/icons";
import type { CSSProperties } from "react";

import { EmptyState } from "@/components/empty-state";
import { useTasks, useWorkspace } from "@/components/tasks/tasks-context";
import { Button } from "@/components/ui/button";
import { addDaysToKey, mondayOfKey } from "@/lib/tasks/dates";
import { epicColor } from "@/lib/tasks/epic";
import { cn } from "@/lib/utils";
import type { RoadmapEpic } from "@/server/tasks/queries";

const MONTH = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekLabel = (key: string) => MONTH.format(new Date(`${key}T00:00:00Z`));

/** Whole weeks from `a` to `b` (both Mondays). */
const weeksBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / (7 * 864e5));

/**
 * The Roadmap: epics on a week timeline, the ones still going first. Each bar runs
 * from the epic's start (its start date, else when it was made or its
 * earliest dated work) to its due date with its progress filled in, and
 * this week's column is marked. An epic with no date anywhere shows from its
 * start for two weeks, dashed, saying so.
 */
export function RoadmapView({ epics }: { epics: RoadmapEpic[] }) {
  const { org, openTask, newTask } = useTasks();
  const ws = useWorkspace();

  if (epics.length === 0) {
    return (
      <div className="bg-card edge rounded-card">
        <EmptyState
          icon={Layers}
          title={ws.filterCount > 0 ? "No epics match that" : "No epics yet"}
          description="An epic is a big outcome that spans weeks, like “Venue and logistics”. Its stories and tasks roll up into it."
          action={
            <Button variant="create" onClick={() => newTask({ type: "EPIC" })}>
              New epic
            </Button>
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
  const ordered: [string, { name: string; color: string; epics: RoadmapEpic[] }][] = [
    ["going", { name: "In progress", color: "var(--brand-accent)", epics: going }],
    ["done", { name: "Done", color: "var(--success)", epics: finishedEpics }],
  ].filter(([, g]) => (g as { epics: RoadmapEpic[] }).epics.length > 0) as [
    string,
    { name: string; color: string; epics: RoadmapEpic[] },
  ][];

  const grid: CSSProperties = {
    gridTemplateColumns: `minmax(140px, 200px) repeat(${weeks.length}, minmax(56px, 1fr))`,
  };

  return (
    <div className="bg-card edge rounded-card overflow-x-auto p-4 sm:p-6">
      <div
        role="table"
        aria-label="Roadmap of epics"
        className="relative grid items-center gap-y-2.5"
        style={{ ...grid, minWidth: 200 + weeks.length * 60 }}
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
              </span>
            </div>
            {g.epics.map((e) => {
              const startCol = clampCol(mondayOfKey(e.start));
              const endCol = clampCol(mondayOfKey(e.end ?? addDaysToKey(e.start, 13)));
              const pct = e.total > 0 ? Math.round((e.done / e.total) * 100) : 0;
              const finished = e.status === "COMPLETED" || (e.total > 0 && e.done === e.total);
              const color = epicColor(e);
              return (
                <div key={e.id} role="row" className="contents">
                  <span role="cell" style={{ gridColumn: 1 }} className="min-w-0 pe-3">
                    <button
                      type="button"
                      onClick={() => openTask(e.id)}
                      className="block w-full truncate text-left text-[13px] font-semibold underline-offset-4 hover:underline"
                    >
                      {e.title}
                    </button>
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
                    title={`${e.title}: ${e.done} of ${e.total} done`}
                  >
                    <i
                      aria-hidden="true"
                      className="absolute inset-y-0 start-0 bg-[color-mix(in_oklab,var(--lc)_42%,var(--card))]"
                      style={{ width: `${pct}%` }}
                    />
                    <span className="relative truncate">
                      {finished ? "Done" : e.total > 0 ? `${pct}%` : "Not broken down yet"}
                      {!e.end && " · no due date"}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
