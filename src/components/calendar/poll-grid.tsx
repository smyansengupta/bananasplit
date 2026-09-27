"use client";

import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

import { dayHeader, dayLabel, timeOfDayLabel } from "./poll-format";
import type { GridPosition, PollGrid, PollSlotLite } from "./poll-grid-utils";

/**
 * The day x time grid both poll views are drawn on: "your availability"
 * (painted) and "everyone" (the heatmap). It owns what they share: the
 * sticky day header and time axis inside one scroll box, hour labels,
 * roving-tabindex keyboard focus (one tab stop; arrows, Home/End and
 * PageUp/PageDown move), and turning a pointer anywhere over the grid into
 * the cell under it, so a touch drag keeps reporting cells after the finger
 * leaves the one it started on. What a cell looks like and what activating
 * it does belong to the caller.
 */

export interface CellRender {
  content?: ReactNode;
  /** Classes for the cell's fill. */
  className?: string;
  style?: CSSProperties;
  /** The whole state of the cell, read by screen readers instead of the fill. */
  ariaLabel: string;
}

const AXIS_REM = 3.25;
const MIN_COL_REM = 2.25;
const MAX_COL_REM = 7;

export function PollGridFrame({
  grid,
  label,
  describedBy,
  granularityMinutes,
  paintable = false,
  renderCell,
  onActivate,
  onFocusSlot,
  onHoverSlot,
  onCellPointerDown,
  onPointerOverCell,
}: {
  grid: PollGrid;
  /** The grid's accessible name. */
  label: string;
  describedBy?: string;
  granularityMinutes: number;
  /** Cells take touch drags as paint strokes instead of scrolling (the time axis still scrolls). */
  paintable?: boolean;
  renderCell: (slot: PollSlotLite, position: GridPosition) => CellRender;
  /** Space/Enter on a cell, or an arrow with Shift held (`extend`). */
  onActivate?: (slot: PollSlotLite, position: GridPosition, options: { extend: boolean }) => void;
  onFocusSlot?: (slot: PollSlotLite) => void;
  /** The cell under a hovering (not pressed) pointer, or null when it leaves the grid. */
  onHoverSlot?: (slot: PollSlotLite | null) => void;
  onCellPointerDown?: (slot: PollSlotLite, position: GridPosition, event: PointerEvent) => void;
  /** Every cell a pointer moves over, pressed or not. */
  onPointerOverCell?: (slot: PollSlotLite, position: GridPosition, event: PointerEvent) => void;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const lastOver = useRef<string | null>(null);
  const [focus, setFocus] = useState<GridPosition>(() => firstCell(grid) ?? { day: 0, time: 0 });
  // A grid redrawn in another zone can have fewer rows or columns.
  const current = grid.cellFor(grid.days[focus.day], grid.times[focus.time])
    ? focus
    : (firstCell(grid) ?? { day: 0, time: 0 });

  const rowHeight = granularityMinutes >= 60 ? 34 : granularityMinutes >= 30 ? 26 : 20;
  const hourRow = (time: string, index: number) => index === 0 || time.endsWith(":00");

  function cellAt(position: GridPosition): PollSlotLite | undefined {
    return grid.cellFor(grid.days[position.day], grid.times[position.time]);
  }

  function focusCell(position: GridPosition) {
    setFocus(position);
    const el = tableRef.current?.querySelector<HTMLElement>(
      `[data-cell="${position.day}:${position.time}"]`,
    );
    el?.focus();
    el?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  /** From `from`, the next existing cell `step` away, skipping gaps. */
  function step(from: GridPosition, dDay: number, dTime: number): GridPosition | null {
    let next = { day: from.day + dDay, time: from.time + dTime };
    while (
      next.day >= 0 &&
      next.day < grid.days.length &&
      next.time >= 0 &&
      next.time < grid.times.length
    ) {
      if (cellAt(next)) return next;
      next = { day: next.day + dDay, time: next.time + dTime };
    }
    return null;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTableElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-cell]");
    if (!target) return;
    const [day, time] = target.dataset.cell!.split(":").map(Number);
    const here = { day, time };
    let next: GridPosition | null = null;
    const page = Math.max(1, Math.round(120 / granularityMinutes));
    switch (event.key) {
      case "ArrowUp":
        next = step(here, 0, -1);
        break;
      case "ArrowDown":
        next = step(here, 0, 1);
        break;
      case "ArrowLeft":
        next = step(here, -1, 0);
        break;
      case "ArrowRight":
        next = step(here, 1, 0);
        break;
      case "PageUp": {
        const target = { day, time: Math.max(0, time - page) };
        next = cellAt(target) ? target : step(target, 0, 1);
        break;
      }
      case "PageDown": {
        const target = { day, time: Math.min(grid.times.length - 1, time + page) };
        next = cellAt(target) ? target : step(target, 0, -1);
        break;
      }
      case "Home":
        next = event.ctrlKey || event.metaKey ? firstCell(grid) : step({ day: -1, time }, 1, 0);
        break;
      case "End":
        next =
          event.ctrlKey || event.metaKey
            ? lastCell(grid)
            : step({ day: grid.days.length, time }, -1, 0);
        break;
      case " ":
      case "Enter": {
        event.preventDefault();
        const slot = cellAt(here);
        if (slot) onActivate?.(slot, here, { extend: false });
        return;
      }
      default:
        return;
    }
    event.preventDefault();
    if (!next) return;
    focusCell(next);
    const slot = cellAt(next);
    if (slot && event.shiftKey && event.key.startsWith("Arrow"))
      onActivate?.(slot, next, { extend: true });
  }

  function cellFromPoint(
    event: PointerEvent,
  ): { slot: PollSlotLite; position: GridPosition } | null {
    const el = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-cell]");
    if (!el || !tableRef.current?.contains(el)) return null;
    const [day, time] = el.dataset.cell!.split(":").map(Number);
    const slot = cellAt({ day, time });
    return slot ? { slot, position: { day, time } } : null;
  }

  function handlePointerMove(event: PointerEvent<HTMLTableElement>) {
    const hit = cellFromPoint(event);
    const key = hit ? `${hit.position.day}:${hit.position.time}` : null;
    if (key === lastOver.current) return;
    lastOver.current = key;
    if (!hit) return;
    onPointerOverCell?.(hit.slot, hit.position, event);
    if (event.buttons === 0) onHoverSlot?.(hit.slot);
  }

  const columnCount = grid.days.length;

  return (
    <div
      className="bg-background relative max-h-[min(70vh,44rem)] overflow-auto rounded-lg border"
      data-slot="poll-grid"
    >
      <table
        ref={tableRef}
        role="grid"
        aria-label={label}
        aria-describedby={describedBy}
        aria-rowcount={grid.times.length + 1}
        aria-colcount={columnCount + 1}
        className="w-full table-fixed border-separate border-spacing-x-[3px] border-spacing-y-px select-none"
        style={{
          minWidth: `${AXIS_REM + columnCount * MIN_COL_REM}rem`,
          maxWidth: `${AXIS_REM + columnCount * MAX_COL_REM}rem`,
        }}
        onKeyDown={handleKeyDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          lastOver.current = null;
          onHoverSlot?.(null);
        }}
      >
        <colgroup>
          <col style={{ width: `${AXIS_REM}rem` }} />
          {grid.days.map((day) => (
            <col key={day} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {/* On a phone the columns are too narrow for "Sep 30": the month
                sits in the corner and each column shows its day, with the
                month again where it changes. */}
            <td
              aria-hidden
              className="bg-background text-muted-foreground sticky top-0 left-0 z-30 pr-1.5 pb-1.5 text-right align-bottom text-xs font-medium sm:text-transparent"
            >
              {grid.days[0] ? dayHeader(grid.days[0]).month : null}
            </td>
            {grid.days.map((day, col) => {
              const { weekday, date, month, day: dayOfMonth } = dayHeader(day);
              const monthChanged = col > 0 && dayHeader(grid.days[col - 1]).month !== month;
              return (
                <th
                  key={day}
                  scope="col"
                  className="bg-background sticky top-0 z-20 px-0.5 pt-2 pb-1.5 text-center font-normal"
                >
                  <span className="sr-only">{dayLabel(day)}</span>
                  <span
                    aria-hidden
                    className="text-muted-foreground block text-[11px] leading-tight uppercase"
                  >
                    {weekday}
                  </span>
                  <span aria-hidden className="block truncate text-xs leading-tight font-medium">
                    <span className="sm:hidden">
                      {monthChanged ? `${month} ${dayOfMonth}` : dayOfMonth}
                    </span>
                    <span className="hidden sm:inline">{date}</span>
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {grid.times.map((time, row) => (
            <tr key={time} style={{ height: rowHeight + (hourRow(time, row) && row > 0 ? 3 : 0) }}>
              <th
                scope="row"
                className={cn(
                  "bg-background text-muted-foreground sticky left-0 z-10 pr-1.5 text-right align-top text-[11px] leading-none font-normal tabular-nums",
                  // Dragging on the axis scrolls, even while the cells paint.
                  paintable && "touch-pan-y",
                )}
              >
                <span className={cn("relative -top-0.5", !hourRow(time, row) && "sr-only")}>
                  {timeOfDayLabel(time)}
                </span>
              </th>
              {grid.days.map((day, col) => {
                const slot = grid.cellFor(day, time);
                if (!slot) return <td key={day} aria-hidden />;
                const position = { day: col, time: row };
                const cell = renderCell(slot, position);
                const isFocus = current.day === col && current.time === row;
                return (
                  <td
                    key={day}
                    role="gridcell"
                    data-cell={`${col}:${row}`}
                    tabIndex={isFocus ? 0 : -1}
                    aria-label={cell.ariaLabel}
                    className={cn(
                      "relative cursor-pointer rounded-[4px] p-0 outline-none",
                      "focus-visible:outline-ring focus-visible:outline-2 focus-visible:outline-offset-1",
                      paintable && "touch-none",
                      // A little air above each hour, so a 15-minute grid reads in hours.
                      hourRow(time, row) && row > 0 && "pt-[3px]",
                    )}
                    onFocus={() => {
                      setFocus(position);
                      onFocusSlot?.(slot);
                    }}
                    onPointerDown={(event) => {
                      setFocus(position);
                      onCellPointerDown?.(slot, position, event);
                    }}
                  >
                    <div
                      aria-hidden
                      className={cn(
                        "flex size-full items-center justify-center rounded-[4px] border text-[11px] leading-none font-medium tabular-nums transition-colors",
                        cell.className,
                      )}
                      style={{ height: rowHeight - 1, ...cell.style }}
                    >
                      {cell.content}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function firstCell(grid: PollGrid): GridPosition | null {
  for (let time = 0; time < grid.times.length; time++) {
    for (let day = 0; day < grid.days.length; day++) {
      if (grid.cellFor(grid.days[day], grid.times[time])) return { day, time };
    }
  }
  return null;
}

function lastCell(grid: PollGrid): GridPosition | null {
  for (let time = grid.times.length - 1; time >= 0; time--) {
    for (let day = grid.days.length - 1; day >= 0; day--) {
      if (grid.cellFor(grid.days[day], grid.times[time])) return { day, time };
    }
  }
  return null;
}
