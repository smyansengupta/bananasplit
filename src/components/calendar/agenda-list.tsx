"use client";

import {
  AlertTriangle,
  CalendarClock,
  CalendarX2,
  CalendarRange,
  Globe,
  Lock,
  MapPin,
} from "@/components/icons";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { agendaDays } from "@/lib/calendar/grid";

import { shortDay } from "./day-label";
import { type CalendarItem, timeRange } from "./item";
import { NO_TAG_LABEL } from "@/lib/calendar/tags";

import { itemStyle, RSVP_META, SYNC_META, VISIBILITY_META } from "./kinds";

/**
 * The agenda: every day in the window that has something on it, in order,
 * as rows you can read without opening anything.
 *
 * This is the view the board actually plans from, so a row carries the
 * whole answer rather than a colour: the time, the title, the type, where
 * it is, whether it is public, the viewer's own RSVP, and for an admin the
 * Google sync state. Days with nothing on them are left out, which is what
 * makes it a list rather than a second month grid.
 */

export function AgendaList({
  items,
  fromKey,
  dayCount,
  todayKey,
  openId,
  onOpen,
  showSync,
  emptyState,
  chipHref,
}: {
  items: readonly CalendarItem[];
  fromKey: string;
  dayCount: number;
  todayKey: string;
  openId: string | null;
  onOpen: (item: CalendarItem, anchor: HTMLElement) => void;
  showSync: boolean;
  emptyState: React.ReactNode;
  /** Where this item lives, for a right-click on its chip. */
  chipHref?: (item: CalendarItem) => string;
}) {
  const days = useMemo(() => agendaDays(items, fromKey, dayCount), [items, fromKey, dayCount]);

  if (days.length === 0) return <div className="cal-agenda">{emptyState}</div>;

  return (
    <div className="cal-agenda">
      {days.map((day) => (
        <section key={day.key} className="cal-agenda__day" aria-labelledby={`agenda-${day.key}`}>
          <h3
            className="cal-agenda__head"
            id={`agenda-${day.key}`}
            data-today={day.key === todayKey ? "true" : undefined}
          >
            <span className="cal-agenda__date">{shortDay(day.key, todayKey)}</span>
            {relativeDay(day.key, todayKey) && (
              <span className="cal-agenda__rel">{relativeDay(day.key, todayKey)}</span>
            )}
          </h3>
          {day.items.map((item) => (
            <AgendaRow
              chipHref={chipHref}
              key={`${day.key}-${item.id}`}
              item={item}
              open={openId === item.id}
              onOpen={onOpen}
              showSync={showSync}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function AgendaRow({
  item,
  open,
  onOpen,
  showSync,
  chipHref,
}: {
  item: CalendarItem;
  open: boolean;
  onOpen: (item: CalendarItem, anchor: HTMLElement) => void;
  showSync: boolean;
  /** Where this item lives, for a right-click on its chip. */
  chipHref?: (item: CalendarItem) => string;
}) {
  const kindLabel = item.tag?.name ?? NO_TAG_LABEL;
  const visibility = VISIBILITY_META[item.visibility];
  const VisIcon = item.visibility === "PUBLIC" ? Globe : Lock;

  return (
    <button
      type="button"
      className="cal-agenda__row"
      style={itemStyle(item)}
      data-task={item.task ? (item.task.done ? "done" : "open") : undefined}
      data-context-href={chipHref?.(item)}
      data-context-label={item.title}
      aria-expanded={open}
      onClick={(event) => onOpen(item, event.currentTarget)}
    >
      {/* The dot rides in the time column so every row's dot lines up. */}
      <span className="cal-agenda__when">
        <span aria-hidden className="cal-chip__dot" />
        {item.task ? "Due" : item.allDay ? "All day" : timeRange(item)}
      </span>

      <span className="min-w-0">
        <span className="cal-agenda__title">{item.title}</span>
        <span className="cal-agenda__meta">
          <span>{item.task ? (item.task.done ? "Task · done" : "Task") : kindLabel}</span>
          {item.location && (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin aria-hidden className="size-3 shrink-0" />
              <span className="truncate">{item.location}</span>
            </span>
          )}
          {!item.allDay && isMultiDay(item) && (
            <span className="inline-flex items-center gap-1">
              <CalendarRange aria-hidden className="size-3" />
              Runs past midnight
            </span>
          )}
        </span>
      </span>

      <span className="cal-agenda__badges">
        {!item.task && (
          <Badge
            variant={item.visibility === "PUBLIC" ? "secondary" : "outline"}
            title={visibility.hint}
          >
            <VisIcon aria-hidden className="size-3" />
            {visibility.label}
          </Badge>
        )}
        {item.rsvp && (
          <Badge
            variant={item.rsvp === "YES" ? "success" : item.rsvp === "NO" ? "outline" : "secondary"}
          >
            {RSVP_META[item.rsvp].short}
          </Badge>
        )}
        {showSync && item.syncState === "FAILED" && (
          <Badge variant="destructive" title={SYNC_META.FAILED.hint}>
            <CalendarX2 aria-hidden className="size-3" />
            {SYNC_META.FAILED.label}
          </Badge>
        )}
        {showSync && item.syncState === "PENDING" && (
          <Badge variant="outline" title={SYNC_META.PENDING.hint}>
            <CalendarClock aria-hidden className="size-3" />
            {SYNC_META.PENDING.label}
          </Badge>
        )}
        {item.needsReview && showSync && (
          <Badge variant="outline" title="Imported with more than one possible match">
            <AlertTriangle aria-hidden className="size-3" />
            Check for a duplicate
          </Badge>
        )}
      </span>
    </button>
  );
}

function isMultiDay(item: CalendarItem): boolean {
  const start = new Date(item.start);
  const end = new Date(item.end);
  return end.getDate() !== start.getDate() && end.getTime() - start.getTime() > 0;
}

/** Beside the day: "Yesterday", "In 5 days", "12 days ago" (Today and Tomorrow say it already). */
function relativeDay(dayKey: string, todayKey: string): string {
  const days = Math.round(
    (Date.parse(`${dayKey}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86_400_000,
  );
  if (days === 0 || days === 1) return "";
  if (days === -1) return "Yesterday";
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}
