"use client";

import { Globe, Lock } from "@/components/icons";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

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
import { type CalendarItem, itemLabel, shortTime, timeRange } from "./item";
import { itemStyle, KIND_META, VISIBILITY_META } from "./kinds";
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
/** Moves, resizes and new events snap to this many minutes. */
const SNAP = 15;
/** A press that travels less than this is a click, not a drag. */
const DRAG_PX = 4;

/** A local instant from a day key and minutes after its midnight. */
function at(dayKey: string, minutes: number): Date {
  const d = new Date(`${dayKey}T00:00:00`);
  d.setMinutes(minutes);
  return d;
}

/** What's being dragged right now, drawn as a ghost on its column. */
type Ghost = { key: string; start: number; end: number; title?: string; id?: string };

export function WeekGrid({
  items,
  fromKey,
  dayCount,
  todayKey,
  openId,
  onOpen,
  showSync,
  onMove,
  onCreate,
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
  /**
   * Drag an event to another time or day, or its bottom edge to change how
   * long it runs (whoever can edit events; tasks don't move here).
   */
  onMove?: (item: CalendarItem, startsAt: Date, endsAt: Date) => void;
  /** Click an empty hour, or drag down an empty stretch, to make an event there. */
  onCreate?: (startsAt: Date, endsAt: Date) => void;
}) {
  const windowKeys = useMemo(() => dayKeysBetween(fromKey, dayCount), [fromKey, dayCount]);
  const byDay = useMemo(() => bucketByDay(items), [items]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The strip's choice is derived, not synchronised: a pick that is no
  // longer in the window (the week moved) simply falls back.
  //
  // The fallback is today when today is in the week, and otherwise the
  // first day that HAS something. Falling back to the Sunday opened an
  // empty column on a week whose events are all midweek, which is a screen
  // that tells you nothing about the week you just asked for.
  const [picked, setPicked] = useState<string | null>(null);
  const pickedDay =
    picked && windowKeys.includes(picked)
      ? picked
      : windowKeys.includes(todayKey)
        ? todayKey
        : (windowKeys.find((key) => (byDay.get(key)?.length ?? 0) > 0) ?? windowKeys[0]);

  const narrow = useMediaQuery("(max-width: 47.99rem)");
  const showStrip = dayCount > 1 && narrow;
  const daysKey = showStrip ? pickedDay : windowKeys.join(",");
  const days = useMemo(
    () => (showStrip ? [pickedDay] : windowKeys),
    [showStrip, pickedDay, windowKeys],
  );

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

  /* ------------------------------------------- drag to move, resize, create
   * Pointer events, not HTML drag and drop: a slot moves in two directions
   * at once (time down the column, day across columns), snaps to a quarter
   * hour and draws where it will land, and it works with a finger too.
   */
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const session = useRef<{
    mode: "move" | "resize" | "create";
    item?: CalendarItem;
    x: number;
    y: number;
    dragged: boolean;
    /** Minutes into the slot where it was grabbed (move). */
    grab: number;
    length: number;
    startKey: string;
    startMin: number;
  } | null>(null);
  /** A click right after a drag is the drag ending, not a click. */
  const swallowClick = useRef(false);

  function pointAt(clientX: number, clientY: number): { key: string; minutes: number } | null {
    const el = document
      .elementFromPoint?.(clientX, clientY)
      ?.closest<HTMLElement>("[data-day]");
    if (!el?.dataset.day) return null;
    const rect = el.getBoundingClientRect();
    const raw = startHour * 60 + ((clientY - rect.top) / HOUR_PX) * 60;
    const minutes = Math.max(0, Math.min(24 * 60, Math.round(raw / SNAP) * SNAP));
    return { key: el.dataset.day, minutes };
  }

  function begin(
    event: ReactPointerEvent<HTMLElement>,
    mode: "move" | "resize" | "create",
    item?: PlacedItem<CalendarItem>,
  ) {
    if (event.button !== 0) return;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    if (mode === "create" && !onCreate) return;
    if (mode !== "create" && (!onMove || !item || item.item.task)) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    session.current = {
      mode,
      item: item?.item,
      x: event.clientX,
      y: event.clientY,
      dragged: false,
      grab: item ? point.minutes - item.startMinutes : 0,
      length: item ? item.endMinutes - item.startMinutes : 60,
      startKey: point.key,
      startMin: item ? item.startMinutes : point.minutes,
    };
  }

  function track(event: ReactPointerEvent<HTMLElement>) {
    const s = session.current;
    if (!s) return;
    if (!s.dragged && Math.hypot(event.clientX - s.x, event.clientY - s.y) < DRAG_PX) return;
    s.dragged = true;
    const point = pointAt(event.clientX, event.clientY);
    if (!point) return;
    if (s.mode === "move") {
      const start = Math.max(0, point.minutes - s.grab);
      setGhost({ key: point.key, start, end: start + s.length, title: s.item?.title, id: s.item?.id });
    } else if (s.mode === "resize") {
      const end = Math.max(s.startMin + SNAP, point.minutes);
      setGhost({ key: s.startKey, start: s.startMin, end, title: s.item?.title, id: s.item?.id });
    } else {
      const a = Math.min(s.startMin, point.minutes);
      const b = Math.max(s.startMin + SNAP, point.minutes);
      setGhost({ key: s.startKey, start: a, end: b });
    }
  }

  function finish(event: ReactPointerEvent<HTMLElement>) {
    const s = session.current;
    session.current = null;
    const g = ghost;
    setGhost(null);
    if (!s) return;
    if (!s.dragged) {
      // A plain click on an empty hour makes an hour-long event from the
      // half hour clicked.
      if (s.mode === "create" && onCreate) {
        const start = Math.floor(s.startMin / 30) * 30;
        onCreate(at(s.startKey, start), at(s.startKey, start + 60));
      }
      return;
    }
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 0);
    event.preventDefault();
    if (!g) return;
    if (s.mode === "create") onCreate?.(at(g.key, g.start), at(g.key, g.end));
    else if (s.item) onMove?.(s.item, at(g.key, g.start), at(g.key, g.end));
  }

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
                    <span key={item.id} className="cal-daystrip__dot" style={itemStyle(item)} />
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
          {/* With the strip above it, a day header inside the grid says the
              same thing twice and costs a band of a phone screen. */}
          {!showStrip && <div className="cal-week__corner" />}
          {!showStrip &&
            days.map((key) => (
              <div
                key={key}
                className="cal-week__dayhead"
                data-today={key === todayKey ? "true" : undefined}
              >
                <span aria-hidden className="cal-week__dow">
                  {DOW[weekdayOf(key)]}
                </span>
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
                    <AllDayChip
                      key={item.id}
                      item={item}
                      open={openId === item.id}
                      onOpen={onOpen}
                    />
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
                data-day={key}
                data-weekend={weekdayOf(key) === 0 || weekdayOf(key) === 6 ? "true" : undefined}
                onPointerDown={(e) => {
                  // Only on empty space: a slot handles its own press.
                  if ((e.target as HTMLElement).closest(".cal-slot")) return;
                  begin(e, "create");
                }}
                onPointerMove={track}
                onPointerUp={finish}
                onPointerCancel={() => {
                  session.current = null;
                  setGhost(null);
                }}
                style={onCreate ? { cursor: "cell" } : undefined}
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
                    onOpen={(item, anchor) => {
                      if (swallowClick.current) return;
                      onOpen(item, anchor);
                    }}
                    showSync={showSync}
                    movable={Boolean(onMove) && !placement.item.task}
                    dragging={ghost?.id === placement.item.id}
                    onGrab={(e) => begin(e, "move", placement)}
                    onGrabEdge={(e) => begin(e, "resize", placement)}
                  />
                ))}

                {ghost && ghost.key === key && (
                  <div
                    aria-hidden
                    className="cal-slot pointer-events-none opacity-70"
                    style={{
                      top: `${((ghost.start - startHour * 60) / 60) * HOUR_PX}px`,
                      height: `${Math.max(((ghost.end - ghost.start) / 60) * HOUR_PX - 2, 18)}px`,
                      left: "2px",
                      width: "calc(100% - 4px)",
                      outline: "2px dashed currentColor",
                    }}
                  >
                    <span className="cal-slot__time">
                      {shortTimeOf(ghost.start)} – {shortTimeOf(ghost.end)}
                    </span>
                    {ghost.title && <span className="cal-slot__title">{ghost.title}</span>}
                  </div>
                )}

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
  movable = false,
  dragging = false,
  onGrab,
  onGrabEdge,
}: {
  placement: PlacedItem<CalendarItem>;
  startHour: number;
  open: boolean;
  onOpen: (item: CalendarItem, anchor: HTMLElement) => void;
  showSync: boolean;
  /** Drag it to move it; drag its bottom edge to change its length. */
  movable?: boolean;
  dragging?: boolean;
  onGrab?: (event: ReactPointerEvent<HTMLElement>) => void;
  onGrabEdge?: (event: ReactPointerEvent<HTMLElement>) => void;
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
        ...itemStyle(item),
        top: `${top}px`,
        height: `${Math.max(height - 2, 18)}px`,
        left: `calc(${lane * width}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        ...(movable ? { cursor: "grab", touchAction: "none" } : {}),
        ...(dragging ? { opacity: 0.4 } : {}),
      }}
      onPointerDown={movable ? onGrab : undefined}
      data-internal={item.visibility === "INTERNAL" ? "true" : undefined}
      data-rsvp={item.rsvp === "YES" ? "yes" : undefined}
      data-compact={compact ? "true" : undefined}
      aria-expanded={open}
      aria-label={itemLabel(
        item,
        KIND_META[item.kind].label,
        VISIBILITY_META[item.visibility].label,
      )}
      onClick={(event) => onOpen(item, event.currentTarget)}
    >
      {/* A half-hour slot is one line tall, and the full range spends it all
          on the time. The start alone is enough there; the popover has the
          rest. */}
      <span aria-hidden className="cal-slot__time">
        {compact ? shortTime(item) : timeRange(item)}
      </span>
      <span aria-hidden className="cal-slot__title">
        {item.title}
      </span>
      {showSync && item.syncState === "FAILED" && (
        <span className="sr-only">Google sync failed</span>
      )}
      {movable && (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
          onPointerDown={(e) => {
            e.stopPropagation();
            onGrabEdge?.(e);
          }}
        />
      )}
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
      style={{ ...itemStyle(item), marginTop: 0 }}
      data-internal={item.visibility === "INTERNAL" && !item.task ? "true" : undefined}
      data-task={item.task ? (item.task.done ? "done" : "open") : undefined}
      data-rsvp={item.rsvp === "YES" ? "yes" : undefined}
      aria-expanded={open}
      aria-label={itemLabel(
        item,
        KIND_META[item.kind].label,
        VISIBILITY_META[item.visibility].label,
      )}
      onClick={(event) => onOpen(item, event.currentTarget)}
    >
      <span className="cal-chip__line">
        <span aria-hidden className="cal-chip__dot" />
        <span aria-hidden className="cal-chip__title">
          {item.title}
        </span>
        {!item.task && (
          <span aria-hidden className="cal-chip__marks">
            <VisIcon className="size-3" />
          </span>
        )}
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

const ghostFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** "6:15 PM" for minutes after midnight. */
function shortTimeOf(minutes: number): string {
  return ghostFmt.format(new Date(2020, 0, 1, Math.floor(minutes / 60), minutes % 60));
}
