"use client";

import { AlertTriangle, CalendarClock, CalendarX2, Globe, Plus } from "lucide-react";

import { bucketByDay, monthGridShape, type MonthCell } from "@/lib/calendar/grid";

import { type CalendarItem, chipTime, itemLabel } from "./item";
import { KIND_META, kindStyle, VISIBILITY_META } from "./kinds";

/**
 * The month view: a real <table>, Sunday first, one full-width chip per
 * event, and a tonal step on the days that carry something.
 *
 * A TABLE RATHER THAN A GRID OF DIVS, which is what the club website
 * settled on too: a screen reader can then announce the weekday for a cell
 * and move by row and column, which a div grid does not offer.
 *
 * On a phone the chips collapse to colour bars (calendar.css) instead of
 * the grid scrolling sideways. The text stays in the DOM, visually hidden,
 * so the bar keeps its full accessible name.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Beyond this a cell shows "+N more" rather than growing without limit. */
const MAX_CHIPS = 3;

export function MonthGrid({
  items,
  fromKey,
  dayCount,
  todayKey,
  openId,
  onOpen,
  onAddOn,
  onShowDay,
  canManage,
  showSync,
  dropDayKey,
  draggingId,
  chipProps,
  dayProps,
}: {
  items: readonly CalendarItem[];
  fromKey: string;
  dayCount: number;
  todayKey: string;
  openId: string | null;
  onOpen: (item: CalendarItem, anchor: HTMLElement) => void;
  onAddOn: (dayKey: string) => void;
  onShowDay: (dayKey: string) => void;
  canManage: boolean;
  showSync: boolean;
  /** The day a dragged chip is currently over. */
  dropDayKey?: string | null;
  draggingId?: string | null;
  /** Extra props for a chip, used to make it draggable (admins, pointer devices). */
  chipProps?: (item: CalendarItem) => Record<string, unknown>;
  /** Extra props for a day cell, used to accept a dropped chip. */
  dayProps?: (dayKey: string) => Record<string, unknown>;
}) {
  const { rows, monthKey } = monthGridShape(fromKey, dayCount, todayKey);
  const byDay = bucketByDay(items);

  return (
    <div className="cal-shell">
      <table className="cal-table">
        <caption className="sr-only">
          {monthLabel(monthKey)}. Select an event for its detail.
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
              {row.map((cell) => (
                <DayCell
                  key={cell.key}
                  cell={cell}
                  items={byDay.get(cell.key) ?? []}
                  openId={openId}
                  onOpen={onOpen}
                  onAddOn={onAddOn}
                  onShowDay={onShowDay}
                  canManage={canManage}
                  showSync={showSync}
                  isDropTarget={dropDayKey === cell.key}
                  draggingId={draggingId ?? null}
                  chipProps={chipProps}
                  dayProps={dayProps}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayCell({
  cell,
  items,
  openId,
  onOpen,
  onAddOn,
  onShowDay,
  canManage,
  showSync,
  isDropTarget,
  draggingId,
  chipProps,
  dayProps,
}: {
  cell: MonthCell;
  items: CalendarItem[];
  openId: string | null;
  onOpen: (item: CalendarItem, anchor: HTMLElement) => void;
  onAddOn: (dayKey: string) => void;
  onShowDay: (dayKey: string) => void;
  canManage: boolean;
  showSync: boolean;
  isDropTarget: boolean;
  draggingId: string | null;
  chipProps?: (item: CalendarItem) => Record<string, unknown>;
  dayProps?: (dayKey: string) => Record<string, unknown>;
}) {
  const shown = items.length > MAX_CHIPS ? items.slice(0, MAX_CHIPS - 1) : items;
  const hidden = items.length - shown.length;

  return (
    <td
      className="cal-td"
      data-day={cell.key}
      data-has-events={items.length > 0 ? "true" : undefined}
      data-outside={cell.inMonth ? undefined : "true"}
      data-today={cell.isToday ? "true" : undefined}
      data-drop={isDropTarget ? "true" : undefined}
      {...dayProps?.(cell.key)}
    >
      <div className="cal-day">
        <span className="cal-day__num">{cell.day}</span>
        {canManage && (
          <button
            type="button"
            className="cal-day__add"
            onClick={() => onAddOn(cell.key)}
            aria-label={`Add an event on ${longDate(cell.key)}`}
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {shown.map((item) => (
        <EventChip
          key={item.id}
          item={item}
          open={openId === item.id}
          dragging={draggingId === item.id}
          onOpen={onOpen}
          showSync={showSync}
          extra={chipProps?.(item)}
        />
      ))}

      {hidden > 0 && (
        <button type="button" className="cal-more" onClick={() => onShowDay(cell.key)}>
          +{hidden} more
          <span className="sr-only"> on {longDate(cell.key)}</span>
        </button>
      )}
    </td>
  );
}

function EventChip({
  item,
  open,
  dragging,
  onOpen,
  showSync,
  extra,
}: {
  item: CalendarItem;
  open: boolean;
  dragging: boolean;
  onOpen: (item: CalendarItem, anchor: HTMLElement) => void;
  showSync: boolean;
  extra?: Record<string, unknown>;
}) {
  const kind = KIND_META[item.kind];
  const visibility = VISIBILITY_META[item.visibility];

  return (
    <button
      type="button"
      className="cal-chip"
      style={kindStyle(item.kind)}
      data-internal={item.visibility === "INTERNAL" ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      aria-expanded={open}
      aria-label={itemLabel(item, kind.label, visibility.label)}
      onClick={(event) => onOpen(item, event.currentTarget)}
      {...extra}
    >
      <span className="cal-chip__line">
        <span aria-hidden className="cal-chip__dot" />
        {!item.allDay && <span aria-hidden className="cal-chip__time">{chipTime(item)}</span>}
        <span aria-hidden className="cal-chip__title">
          {item.title}
        </span>
        {/*
          Only the consequential state is marked. Public means the world can
          read it on the website, which is worth a globe; internal is the
          default and is carried by the chip's dashed border, the legend and
          the chip's own accessible name. Marking both put two icons on
          every chip in a 120px cell and said nothing either way.
        */}
        <span aria-hidden className="cal-chip__marks">
          {item.visibility === "PUBLIC" && <Globe className="size-3" />}
          {showSync && item.syncState === "PENDING" && <CalendarClock className="size-3" />}
          {showSync && item.syncState === "FAILED" && <CalendarX2 className="size-3" />}
          {item.needsReview && <AlertTriangle className="size-3" />}
        </span>
      </span>
    </button>
  );
}

const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** "September 2026" from a "YYYY-MM" key. */
export function monthLabel(monthKey: string): string {
  return monthFmt.format(new Date(`${monthKey}-01T00:00:00Z`));
}

/** "Thursday, September 24" from a "YYYY-MM-DD" key. */
export function longDate(dayKey: string): string {
  return longFmt.format(new Date(`${dayKey}T00:00:00Z`));
}
