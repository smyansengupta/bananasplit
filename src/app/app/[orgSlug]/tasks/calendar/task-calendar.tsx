"use client";

import { CalendarOff, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { useMemo, useState } from "react";

import "@/components/calendar/calendar.css";
import { longDate, monthLabel } from "@/components/calendar/month-grid";
import { Button } from "@/components/ui/button";
import { STATUS_LABEL, STATUS_TOKEN } from "@/components/tasks/layout-ui";
import { isTaskPrivate } from "@/components/tasks/task-badges";
import { useTasks } from "@/components/tasks/tasks-context";
import type { TaskItem } from "@/components/tasks/types";
import { monthGridShape, monthWindowFor, shiftMonthKey, localDayKey } from "@/lib/calendar/grid";
import { dueDateKey } from "@/lib/tasks/dates";
import { cn } from "@/lib/utils";

import { updateTask } from "../actions";

/**
 * Due dates on a month: the same month table, chips and header as the main
 * Calendar (calendar.css), so the two read as one product. A chip's colour
 * is its status. Drag a chip to another day to move its due date, or drag
 * an undated task from the tray onto a day to give it one.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MAX_CHIPS = 3;

function chipTitle(t: TaskItem): string {
  return `${t.parentTask ? `${t.parentTask.title} / ` : ""}${t.title}`;
}

export function TaskCalendar({ tasks }: { tasks: TaskItem[] }) {
  const { org, announce, showTask } = useTasks();
  const todayKey = localDayKey(new Date());
  const [monthKey, setMonthKey] = useState(todayKey.slice(0, 7));
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  // Optimistic due dates while a move saves.
  const [moved, setMoved] = useState<Record<string, string>>({});

  const due = (t: TaskItem) => moved[t.id] ?? (t.dueDate ? dueDateKey(t.dueDate) : null);
  const { fromKey, toKey } = monthWindowFor(monthKey);
  const dayCount = Math.round(
    (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000,
  );
  const { rows } = monthGridShape(fromKey, dayCount, todayKey);

  const byDay = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    for (const t of tasks) {
      const key = moved[t.id] ?? (t.dueDate ? dueDateKey(t.dueDate) : null);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => Number(a.status === "COMPLETED") - Number(b.status === "COMPLETED"));
    }
    return map;
  }, [tasks, moved]);
  const undated = tasks.filter((t) => !due(t) && t.status !== "COMPLETED");
  const inMonth = tasks.filter((t) => due(t)?.startsWith(monthKey)).length;

  function move(taskId: string, dayKey: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || due(task) === dayKey) return;
    setMoved((m) => ({ ...m, [taskId]: dayKey }));
    updateTask(org.id, taskId, { dueDate: dayKey })
      .then((result) => {
        if (result.error) {
          announce(result.error);
          setMoved(({ [taskId]: _, ...rest }) => rest);
        } else {
          announce(`Due ${longDate(dayKey)}.`);
        }
      })
      .catch(() => setMoved(({ [taskId]: _, ...rest }) => rest));
  }

  const dragProps = (t: TaskItem) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("text/plain", t.id);
      e.dataTransfer.effectAllowed = "move";
      setDragId(t.id);
    },
    onDragEnd: () => {
      setDragId(null);
      setDropKey(null);
    },
  });

  return (
    <div className="cal space-y-4">
      <div className="cal-head">
        <div className="cal-head__label">
          <h2 className="cal-head__month">{monthLabel(monthKey)}</h2>
          <p className="cal-head__count">
            {inMonth} task{inMonth === 1 ? "" : "s"} due this month
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => setMonthKey(shiftMonthKey(monthKey, -1))} aria-label="Previous month">
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setMonthKey(shiftMonthKey(monthKey, 1))} aria-label="Next month">
            <ChevronRight aria-hidden className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonthKey(todayKey.slice(0, 7))} disabled={monthKey === todayKey.slice(0, 7)}>
            Today
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="cal-shell min-w-0 flex-1">
          <table className="cal-table">
            <caption className="sr-only">
              Tasks due in {monthLabel(monthKey)}. Select a task to open it.
            </caption>
            <thead>
              <tr>
                {DAYS.map((day) => (
                  <th key={day} scope="col" className="cal-th">
                    <span aria-hidden className="hidden md:inline">
                      {day.slice(0, 3)}
                    </span>
                    <span aria-hidden className="md:hidden">
                      {day.slice(0, 1)}
                    </span>
                    <span className="sr-only">{day}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell) => {
                    const items = byDay.get(cell.key) ?? [];
                    const all = expanded === cell.key;
                    const shown = all || items.length <= MAX_CHIPS ? items : items.slice(0, MAX_CHIPS - 1);
                    return (
                      <td
                        key={cell.key}
                        className="cal-td"
                        data-day={cell.key}
                        data-has-events={items.length > 0 ? "true" : undefined}
                        data-outside={cell.inMonth ? undefined : "true"}
                        data-today={cell.isToday ? "true" : undefined}
                        data-drop={dropKey === cell.key ? "true" : undefined}
                        onDragOver={(e) => {
                          if (!dragId) return;
                          e.preventDefault();
                          setDropKey(cell.key);
                        }}
                        onDragLeave={() => setDropKey((k) => (k === cell.key ? null : k))}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData("text/plain");
                          setDropKey(null);
                          setDragId(null);
                          if (id) move(id, cell.key);
                        }}
                      >
                        <div className="cal-day">
                          <span className="cal-day__num">{cell.day}</span>
                        </div>
                        {shown.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className="cal-chip"
                            style={{ ["--kind" as string]: STATUS_TOKEN[t.status] ?? "var(--chart-1)" }}
                            data-internal={isTaskPrivate(t) ? "true" : undefined}
                            data-dragging={dragId === t.id ? "true" : undefined}
                            aria-label={`${chipTitle(t)}, ${STATUS_LABEL[t.status] ?? t.status}${t.owner?.name ? `, ${t.owner.name}` : ""}`}
                            onClick={() => showTask(t)}
                            {...dragProps(t)}
                          >
                            <span className="cal-chip__line">
                              <span aria-hidden className="cal-chip__dot" />
                              <span
                                aria-hidden
                                className={cn("cal-chip__title", t.status === "COMPLETED" && "line-through opacity-60")}
                              >
                                {chipTitle(t)}
                              </span>
                              {isTaskPrivate(t) && (
                                <span aria-hidden className="cal-chip__marks">
                                  <Lock className="size-3" />
                                </span>
                              )}
                            </span>
                          </button>
                        ))}
                        {!all && items.length > shown.length && (
                          <button type="button" className="cal-more" onClick={() => setExpanded(cell.key)}>
                            +{items.length - shown.length} more
                            <span className="sr-only"> on {longDate(cell.key)}</span>
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="w-full shrink-0 space-y-3 lg:w-64">
          <div>
            <h2 className="text-sm font-medium">No due date</h2>
            <p className="text-muted-foreground text-xs">Drag one onto a day to schedule it.</p>
          </div>
          {undated.length === 0 ? (
            <div className="text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs">
              <CalendarOff className="size-4" aria-hidden="true" />
              Everything open has a date.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {undated.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => showTask(t)}
                    className="cal-chip cursor-grab active:cursor-grabbing"
                    style={{ ["--kind" as string]: STATUS_TOKEN[t.status] ?? "var(--chart-1)" }}
                    data-internal={isTaskPrivate(t) ? "true" : undefined}
                    {...dragProps(t)}
                  >
                    <span className="cal-chip__line">
                      <span aria-hidden className="cal-chip__dot" />
                      <span className="cal-chip__title">{chipTitle(t)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ul className="text-muted-foreground space-y-1 border-t pt-3 text-xs" aria-label="Colours">
            {Object.entries(STATUS_LABEL).map(([status, label]) => (
              <li key={status} className="flex items-center gap-2">
                <span className="size-2 rounded-full" style={{ background: STATUS_TOKEN[status] }} />
                {label}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
