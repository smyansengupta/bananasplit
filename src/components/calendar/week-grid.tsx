"use client";

import { Globe, Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  bucketByDay,
  dayKeysBetween,
  MIN_SLOT_MINUTES,
  placeDayItems,
  visibleHourRange,
  weekdayOf,
  type PlacedItem,
} from "@/lib/calendar/grid";

import { useMediaQuery, useNowMinutes } from "./hooks";
import { type CalendarItem, itemLabel, timeRange } from "./item";
import { KIND_META, kindStyle, VISIBILITY_META } from "./kinds";
import { longDate } from "./month-grid";

/**
 * The week (and single day) view: an hour column per day, with an all-day
 * band above it.
 *
 * TWO THINGS IT DOES THAT A FULL 24-HOUR COLUMN DOES NOT.
 *
 * It opens on the hours that have something in them rather than on 12am
 * (visibleHourRange). A club runs evenings, so a full day column spends the
 * whole viewport on empty night and pushes every real event below the fold.
 *
 * On a phone a seven-day week shows ONE day at a time under a seven-day
 * strip, rather than squeezing seven columns into 390px or scrolling
 * sideways. Seven columns at that width are about 50px each, which cannot
 * hold a title; one full-width column can, and the strip keeps the rest of
 * the week one tap away while showing which days carry something.
 */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Matches --cal-hour-height in calendar.css. */
const HOUR_PX = 52;
/** Below this a slot puts its time inline with the title instead of above it. */
const COMPACT_MINUTES = 45;

export function WeekGrid({
  items,
  fromKey,
  dayCount,
  todayKey,
  openId,
  onOpen,
  showSync,
}: {
  items: readonly CalendarItem[];
  /** The first day of the window (a Sunday for a week). */
  fromKey: string;
  /** 7 for a week, 1 for a single day. */
  dayCount: number;
  todayKey: string;
  openId: string | null;
  onOpen: (item: CalendarItem, anchor: HTMLElement) => void;
  showSync: boolean;
}) {
  const windowKeys = useMemo(() => dayKeysBetween(fromKey, dayCount), [fromKey, dayCount]);
  const byDay = useMemo(() => bucketByDay(items), [items]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The strip's choice is derived, not synchronised: a pick that is no
  // longer in the window (the week moved) simply falls back to today, or to
  // the first day when today is elsewhere.
  const [picked, setPicked] = useState<string | null>(null);
  const pickedDay =
    picked && windowKeys.includes(picked)
      ? picked
      : windowKeys.includes(todayKey)
        ? todayKey
        : windowKeys[0];

  const narrow = useMediaQuery("(max-width: 47.99rem)");
  const showStrip = dayCount > 1 && narrow;
  const daysKey = showStrip ? pickedDay : windowKeys.join(",");
  const days = useMemo(() => (showStrip ? [pickedDay] : windowKeys), [showStrip, pickedDay, windowKeys]);

  const placements = useMemo(
    () => days.map((key) => ({ key, placed: placeDayItems(key, byDay.get(key) ?? []) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byDay, daysKey],
  );

  const { startHour, endHour } = useMemo(
    () => visibleHourRange(placements.flatMap((d) => d.placed)),
    [placements],
  );
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  );

  const nowOffset = useNowOffset(startHour, endHour);
  const todayOnScreen = days.includes(todayKey);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || nowOffset === null || !todayOnScreen) return;
    el.scrollTop = Math.max(0, nowOffset - el.clientHeight / 2);
    // Only when the window itself changes, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysKey, startHour]);

  const allDayByDay = days.map((key) => ({
    key,
    items: (byDay.get(key) ?? []).filter((item) => item.allDay),
  }));
  const hasAllDay = allDayByDay.some((d) => d.items.length > 0);

  return (
    <div className="space-y-3">
      {showStrip && (
        <div className="cal-daystrip" role="group" aria-label="Pick a day">
          {windowKeys.map((key) => {
            const dayItems = byDay.get(key) ?? [];
            return (
              <button
                key={key}
                type="button"
                className="cal-daystrip__day"
                aria-pressed={key === pickedDay}
                data-today={key === todayKey ? "true" : undefined}
                onClick={() => setPicked(key)}
              >
                <span aria-hidden className="cal-daystrip__dow">
                  {DOW[weekdayOf(key)].slice(0, 1)}
                </span>
                <span aria-hidden className="cal-daystrip__num">
                  {Number(key.slice(8, 10))}
                </span>
                <span aria-hidden className="cal-daystrip__dots">
                  {dayItems.slice(0, 3).map((item) => (
                    <span key={item.id} className="cal-daystrip__dot" style={kindStyle(item.kind)} />
                  ))}
                </span>
                <span className="sr-only">
                  {longDate(key)}
                  {dayItems.length === 0
                    ? ", nothing scheduled"
                    : `, ${dayItems.length} ${dayItems.length === 1 ? "event" : "events"}`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="cal-week">
        <div className="cal-week__grid" style={{ ["--cal-days" as string]: days.length }}>
          <div className="cal-week__corner" />
          {days.map((key) => (
            <div key={key} className="cal-week__dayhead" data-today={key === todayKey ? "true" : undefined}>
              <span aria-hidden className="cal-week__dow">
                {DOW[weekdayOf(key)]}
              </span>
              <br aria-hidden />
              <span aria-hidden className="cal-week__date">
                {Number(key.slice(8, 10))}
              </span>
              <span className="sr-only">{longDate(key)}</span>
            </div>
          ))}

          {hasAllDay && (
            <>
              <div className="cal-week__allday-label">All day</div>
              {allDayByDay.map(({ key, items: dayItems }) => (
                <div key={key} className="cal-week__allday">
                  {dayItems.map((item) => (
                    <AllDayChip key={item.id} item={item} open={openId === item.id} onOpen={onOpen} />
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        <div className="cal-week__scroll" ref={scrollRef}>
          <div className="cal-week__grid" style={{ ["--cal-days" as string]: days.length }}>
            <div className="cal-week__axis">
              {hours.map((hour) => (
                <div key={hour} className="cal-week__hour">
                  <span className="cal-week__hourlabel">{hourLabel(hour)}</span>
                </div>
              ))}
            </div>

            {placements.map(({ key, placed }) => (
              <div
                key={key}
                className="cal-week__col"
                data-weekend={weekdayOf(key) === 0 || weekdayOf(key) === 6 ? "true" : undefined}
              >
                {hours.map((hour) => (
                  <div key={hour} className="cal-week__hour" />
                ))}

                {placed.map((placement) => (
                  <Slot
                    key={placement.item.id}
                    placement={placement}
                    startHour={startHour}
                    open={openId === placement.item.id}
                    onOpen={onOpen}
                    showSync={showSync}
                  />
                ))}

                {key === todayKey && nowOffset !== null && (
                  <div className="cal-now" style={{ top: `${nowOffset}px` }} aria-hidden />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Slot({
  placement,
  startHour,
  open,
  onOpen,
  showSync,
}: {
  placement: PlacedItem<CalendarItem>;
  startHour: number;
  open: boolean;
  onOpen: (item: CalendarItem, anchor: HTMLElement) => void;
  showSync: boolean;
}) {
  const { item, startMinutes, endMinutes, lane, lanes } = placement;
  const drawnEnd = Math.max(endMinutes, startMinutes + MIN_SLOT_MINUTES);
  const top = ((startMinutes - startHour * 60) / 60) * HOUR_PX;
  const height = ((drawnEnd - startMinutes) / 60) * HOUR_PX;
  const width = 100 / lanes;
  const compact = drawnEnd - startMinutes <= COMPACT_MINUTES;

  return (
    <button
      type="button"
      className="cal-slot"
      style={{
        ...kindStyle(item.kind),
        top: `${top}px`,
        height: `${Math.max(height - 2, 18)}px`,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
      }}
      data-internal={item.visibility === "INTERNAL" ? "true" : undefined}
      data-compact={compact ? "true" : undefined}
      aria-expanded={open}
      aria-label={itemLabel(item, KIND_META[item.kind].label, VISIBILITY_META[item.visibility].label)}
      onClick={(event) => onOpen(item, event.currentTarget)}
    >
      <span aria-hidden className="cal-slot__time">
        {timeRange(item)}
      </span>
      <span aria-hidden className="cal-slot__title">
        {item.title}
      </span>
      {showSync && item.syncState === "FAILED" && <span className="sr-only">Google sync failed</span>}
    </button>
  );
}

function AllDayChip({
  item,
  open,
  onOpen,
}: {
  item: CalendarItem;
  open: boolean;
  onOpen: (item: CalendarItem, anchor: HTMLElement) => void;
}) {
  const VisIcon = item.visibility === "PUBLIC" ? Globe : Lock;
  return (
    <button
      type="button"
      className="cal-chip"
      style={{ ...kindStyle(item.kind), marginTop: 0 }}
      data-internal={item.visibility === "INTERNAL" ? "true" : undefined}
      aria-expanded={open}
      aria-label={itemLabel(item, KIND_META[item.kind].label, VISIBILITY_META[item.visibility].label)}
      onClick={(event) => onOpen(item, event.currentTarget)}
    >
      <span className="cal-chip__line">
        <span aria-hidden className="cal-chip__dot" />
        <span aria-hidden className="cal-chip__title">
          {item.title}
        </span>
        <span aria-hidden className="cal-chip__marks">
          <VisIcon className="size-3" />
        </span>
      </span>
    </button>
  );
}

/**
 * Where "now" sits in the hour column, in pixels, or null when the time is
 * outside the visible hours. Null on the server too: there is no "now" in
 * the viewer's timezone until the browser has it.
 */
function useNowOffset(startHour: number, endHour: number): number | null {
  const minutes = useNowMinutes();
  if (minutes === null) return null;
  if (minutes < startHour * 60 || minutes > endHour * 60) return null;
  return ((minutes - startHour * 60) / 60) * HOUR_PX;
}

const hourFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

function hourLabel(hour: number): string {
  return hourFmt.format(new Date(2020, 0, 1, hour));
}
