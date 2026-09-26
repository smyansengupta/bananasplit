"use client";

import { CalendarClock, CalendarPlus, CalendarX2, ChevronLeft, ChevronRight, Globe } from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";

import { moveEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EventKind, EventVisibility } from "@/generated/prisma/enums";
import { addDaysToKey } from "@/lib/calendar/dates";
import {
  dayWindowFor,
  localDayKey,
  monthWindowFor,
  shiftMonthKey,
  weekWindowFor,
  windowDays,
} from "@/lib/calendar/grid";
import { calendarSearch, type CalendarView } from "@/lib/calendar/range";
import { cn } from "@/lib/utils";

import { AgendaList } from "./agenda-list";
import "./calendar.css";
import { useTodayKey } from "./hooks";
import { anchorFor, EventPeek, type PeekAnchor } from "./event-peek";
import type { EventFormEvent } from "./event-form-dialog";
import type { CalendarItem } from "./item";
import { KIND_META, KIND_ORDER, kindStyle } from "./kinds";
import { longDate, MonthGrid, monthLabel } from "./month-grid";
import type { CalendarMember } from "./member-picker";
import { WeekGrid } from "./week-grid";

export type { CalendarItem } from "./item";

/**
 * The org calendar: month, week, day and agenda, rendered here rather than
 * handed to a calendar library.
 *
 * WHY OUR OWN GRID. The look this is modelled on (the club website's events
 * calendar) is structural, not a skin: a real table, a tonal step on days
 * that carry something, one full-width chip per event, colour bars instead
 * of a sideways scroll on a phone, and a detail card anchored to the chip.
 * Bending a library's markup into that was more code than writing the three
 * views, and it cost the default route a few hundred kilobytes of
 * JavaScript for a grid that is, in the end, a table and some arithmetic.
 * The layout maths is in src/lib/calendar/grid.ts, where it is unit-tested.
 *
 * The visible window still lives in the URL (?from=&to=&view=), so the
 * server keeps reading only the weeks on screen, and the filters keep
 * working the way they did.
 */

export interface CalendarWindow {
  fromKey: string;
  toKey: string;
  view: CalendarView;
  kinds: EventKind[];
  visibility: EventVisibility | null;
}

/** Loaded on demand: nobody who is only reading the calendar pays for the form. */
const EventFormDialog = dynamic(
  () => import("./event-form-dialog").then((m) => m.EventFormDialog),
  { ssr: false },
);

const VIEW_LABELS: { view: CalendarView; label: string }[] = [
  { view: "dayGridMonth", label: "Month" },
  { view: "timeGridWeek", label: "Week" },
  { view: "timeGridDay", label: "Day" },
  { view: "listMonth", label: "List" },
];

export function EventCalendar({
  orgId,
  orgSlug,
  timeZone,
  items,
  members,
  canManage,
  window: range,
  orgTodayKey,
}: {
  orgId: string;
  orgSlug: string;
  timeZone: string;
  items: CalendarItem[];
  members: CalendarMember[];
  /** OWNER/ADMIN: create, edit, drag and delete (the server re-checks every write). */
  canManage: boolean;
  window: CalendarWindow;
  /** Today in the org timezone, so the server and the first paint agree. */
  orgTodayKey: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [peek, setPeek] = useState<PeekAnchor | null>(null);
  const [dialog, setDialog] = useState<
    { mode: "create"; start: Date | null; allDay: boolean } | { mode: "edit"; event: EventFormEvent } | null
  >(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);

  // Today is read in the org timezone on the server so the first paint
  // matches, then swapped for the viewer's own day on hydration.
  const todayKey = useTodayKey(orgTodayKey);

  const dayCount = windowDays(range.fromKey, range.toKey);
  const monthKey = useMemo(
    () => (range.view === "timeGridWeek" || range.view === "timeGridDay" ? range.fromKey.slice(0, 7) : midMonth(range.fromKey, dayCount)),
    [range.view, range.fromKey, dayCount],
  );

  const navigate = useCallback(
    (next: CalendarWindow) => {
      const search = calendarSearch(next);
      if (search === calendarSearch(range)) return;
      setPeek(null);
      startTransition(() => router.replace(`${pathname}?${search}`, { scroll: false }));
    },
    [pathname, range, router],
  );

  function step(delta: number) {
    if (range.view === "timeGridWeek") {
      const fromKey = addDaysToKey(range.fromKey, delta * 7);
      navigate({ ...range, fromKey, toKey: addDaysToKey(fromKey, 7) });
      return;
    }
    if (range.view === "timeGridDay") {
      navigate({ ...range, ...dayWindowFor(addDaysToKey(range.fromKey, delta)) });
      return;
    }
    navigate({ ...range, ...monthWindowFor(shiftMonthKey(monthKey, delta)) });
  }

  function goToday() {
    if (range.view === "timeGridWeek") navigate({ ...range, ...weekWindowFor(todayKey) });
    else if (range.view === "timeGridDay") navigate({ ...range, ...dayWindowFor(todayKey) });
    else navigate({ ...range, ...monthWindowFor(todayKey.slice(0, 7)) });
  }

  function setView(view: CalendarView) {
    if (view === range.view) return;
    const anchor = range.view === "dayGridMonth" || range.view === "listMonth" ? anchorDay(monthKey, todayKey) : range.fromKey;
    if (view === "timeGridWeek") navigate({ ...range, view, ...weekWindowFor(anchor) });
    else if (view === "timeGridDay") navigate({ ...range, view, ...dayWindowFor(anchor) });
    else navigate({ ...range, view, ...monthWindowFor(anchor.slice(0, 7)) });
  }

  function toggleKind(kind: EventKind) {
    const kinds = range.kinds.includes(kind) ? range.kinds.filter((k) => k !== kind) : [...range.kinds, kind];
    navigate({ ...range, kinds: KIND_ORDER.filter((k) => kinds.includes(k)) });
  }

  const openPeek = useCallback((item: CalendarItem, chip: HTMLElement) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    setPeek((current) => (current?.id === item.id ? null : anchorFor(chip, wrap, item.id)));
  }, []);

  function openCreate(start: Date | null, allDay = false) {
    setPeek(null);
    setDialog({ mode: "create", start, allDay });
  }

  /** A day cell's "+": most club events are evenings, so 6pm that day. */
  function addOn(dayKey: string) {
    const at = new Date(`${dayKey}T18:00:00`);
    openCreate(Number.isNaN(at.getTime()) ? null : at, false);
  }

  function openEdit(item: CalendarItem) {
    setPeek(null);
    // The grid carries a summary, not the whole record; the form dialog is
    // opened from the event's own page for a full edit. Here we hand it the
    // id and let it load nothing else: the summary fields are what a quick
    // edit from the grid touches.
    router.push(`/app/${orgSlug}/calendar/${item.id}?edit=1`);
  }

  /* ---------------------------------------------------------- drag to move
   * Native drag and drop rather than a drag library: dropping a chip on
   * another day is the whole interaction, and the platform already does it
   * for nothing. Touch has no HTML drag, which is fine — the same move is
   * one tap away in the event's own form, and touch users are rarely
   * rearranging a term's calendar on a phone.
   */
  const dragProps = canManage
    ? (item: CalendarItem) => ({
        draggable: true,
        onDragStart: (event: React.DragEvent) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", item.id);
          setDrag({ id: item.id, over: null });
        },
        onDragEnd: () => setDrag(null),
      })
    : undefined;

  const dayDropProps = canManage
    ? (dayKey: string) => ({
        onDragOver: (event: React.DragEvent) => {
          if (!drag) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          if (drag.over !== dayKey) setDrag({ ...drag, over: dayKey });
        },
        onDrop: (event: React.DragEvent) => {
          event.preventDefault();
          const id = event.dataTransfer.getData("text/plain") || drag?.id;
          setDrag(null);
          if (id) moveToDay(id, dayKey);
        },
      })
    : undefined;

  function moveToDay(id: string, dayKey: string) {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const firstDay = item.allDay ? item.start : localDayKey(new Date(item.start));
    if (firstDay === dayKey) return;
    const delta = Math.round(
      (Date.parse(`${dayKey}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000,
    );
    setMoveError(null);
    const times = item.allDay
      ? {
          allDay: true,
          startsAt: addDaysToKey(item.start, delta),
          endsAt: addDaysToKey(addDaysToKey(item.end, -1), delta),
        }
      : {
          allDay: false,
          // setDate keeps the wall-clock time across a DST boundary.
          startsAt: shiftDays(new Date(item.start), delta).toISOString(),
          endsAt: shiftDays(new Date(item.end), delta).toISOString(),
        };
    startTransition(async () => {
      const result = await moveEvent(orgId, id, times);
      if (result?.error) setMoveError(result.error);
      else router.refresh();
    });
  }

  const openItem = peek ? (items.find((i) => i.id === peek.id) ?? null) : null;
  const count = items.length;
  const countLabel = count === 0 ? "Nothing scheduled" : count === 1 ? "1 event" : `${count} events`;

  const emptyState = (
    <div className="cal-empty">
      <CalendarPlus aria-hidden className="text-muted-foreground size-6" />
      <p className="cal-empty__title">{emptyTitle(range)}</p>
      <p className="cal-empty__body">
        {range.kinds.length > 0 || range.visibility
          ? "No event here matches the filters. Clear them to see everything in this window."
          : canManage
            ? "Add a workshop, a social or a board meeting, and it appears here and on the website if you make it public."
            : "Sessions the board schedules show up here. You will be notified when you are invited to one."}
      </p>
      <div className="mt-1 flex gap-2">
        {(range.kinds.length > 0 || range.visibility) && (
          <Button size="sm" variant="outline" onClick={() => navigate({ ...range, kinds: [], visibility: null })}>
            Clear filters
          </Button>
        )}
        {canManage && range.kinds.length === 0 && !range.visibility && (
          <Button size="sm" onClick={() => openCreate(null)}>
            New event
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="cal space-y-4">
      <div className="cal-head">
        <div className="cal-head__label">
          <h2 className="cal-head__month">{rangeLabel(range, monthKey, dayCount)}</h2>
          <p className="cal-head__count">
            {countLabel}
            {isPending && <span className="ml-2 opacity-70">Loading…</span>}
          </p>
        </div>

        {/*
          On a phone this is two rows rather than three: stepping and
          creating on one, the view switcher spanning the width below it.
          Letting four blocks wrap on their own put "New event" alone on a
          line of its own and cost a band of screen where it is scarcest.
        */}
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label={prevLabel(range.view)}>
              <ChevronLeft aria-hidden className="size-4" />
            </Button>
            <Button variant="outline" size="icon" onClick={() => step(1)} aria-label={nextLabel(range.view)}>
              <ChevronRight aria-hidden className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday} disabled={isTodayInWindow(range, todayKey, dayCount)}>
              Today
            </Button>
          </div>

          {canManage && (
            <Button size="sm" className="ml-auto md:order-3 md:ml-0" onClick={() => openCreate(null)}>
              New event
            </Button>
          )}

          <div
            className="bg-muted order-last flex w-full rounded-md p-0.5 md:order-2 md:w-auto"
            role="group"
            aria-label="Calendar view"
          >
            {VIEW_LABELS.map(({ view, label }) => (
              <button
                key={view}
                type="button"
                aria-pressed={range.view === view}
                onClick={() => setView(view)}
                className={cn(
                  "flex-1 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors md:flex-none",
                  range.view === view
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-0.5">
        <div className="cal-filters">
          <span className="sr-only" id="cal-kind-filter-label">
            Filter by type
          </span>
          {KIND_ORDER.map((kind) => {
            const active = range.kinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                className="cal-filter"
                style={kindStyle(kind)}
                aria-pressed={active}
                aria-describedby="cal-kind-filter-label"
                onClick={() => toggleKind(kind)}
              >
                <span aria-hidden className="cal-filter__dot" />
                {KIND_META[kind].label}
              </button>
            );
          })}
          <Select
            value={range.visibility ?? "ALL"}
            onValueChange={(v) => navigate({ ...range, visibility: v === "ALL" ? null : (v as EventVisibility) })}
          >
            <SelectTrigger size="sm" className="w-auto min-w-38 shrink-0" aria-label="Filter by visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Public and internal</SelectItem>
              <SelectItem value="PUBLIC">Public only</SelectItem>
              <SelectItem value="INTERNAL">Internal only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {moveError && (
        <p className="text-destructive text-sm" role="alert">
          {moveError}
        </p>
      )}

      <div className={cn("cal-wrap transition-opacity", isPending && "opacity-60")} ref={wrapRef}>
        {range.view === "dayGridMonth" && (
          <MonthGrid
            items={items}
            fromKey={range.fromKey}
            dayCount={dayCount}
            todayKey={todayKey}
            openId={peek?.id ?? null}
            onOpen={openPeek}
            onAddOn={addOn}
            onShowDay={(dayKey) => navigate({ ...range, view: "timeGridDay", ...dayWindowFor(dayKey) })}
            canManage={canManage}
            showSync={canManage}
            dropDayKey={drag?.over ?? null}
            draggingId={drag?.id ?? null}
            chipProps={dragProps}
            dayProps={dayDropProps}
          />
        )}

        {(range.view === "timeGridWeek" || range.view === "timeGridDay") && (
          <WeekGrid
            items={items}
            fromKey={range.fromKey}
            dayCount={range.view === "timeGridDay" ? 1 : 7}
            todayKey={todayKey}
            openId={peek?.id ?? null}
            onOpen={openPeek}
            showSync={canManage}
          />
        )}

        {range.view === "listMonth" && (
          <AgendaList
            items={items}
            fromKey={range.fromKey}
            dayCount={dayCount}
            todayKey={todayKey}
            openId={peek?.id ?? null}
            onOpen={openPeek}
            showSync={canManage}
            emptyState={emptyState}
          />
        )}

        {openItem && peek && (
          <EventPeek
            item={openItem}
            anchor={peek}
            orgSlug={orgSlug}
            canManage={canManage}
            showSync={canManage}
            onClose={() => setPeek(null)}
            onEdit={openEdit}
          />
        )}
      </div>

      {count === 0 && range.view !== "listMonth" && (
        <div className="cal-agenda">{emptyState}</div>
      )}

      <div className="cal-legend">
        <span className="cal-legend__item">
          <Globe aria-hidden className="size-3" /> Public: on the website
        </span>
        <span className="cal-legend__item">
          <span
            aria-hidden
            className="border-muted-foreground/70 inline-block h-3 w-5 rounded-sm border border-dashed"
          />
          Internal: board and members only
        </span>
        {canManage && (
          <>
            <span className="cal-legend__item">
              <CalendarClock aria-hidden className="size-3" /> Syncing to Google
            </span>
            <span className="cal-legend__item">
              <CalendarX2 aria-hidden className="size-3" /> Google sync failed
            </span>
          </>
        )}
        <span>Times are in your timezone; all-day events are whole days in {timeZone}.</span>
        {canManage && <span className="hidden md:inline">Drag an event in the month grid to move it.</span>}
      </div>

      {canManage && dialog?.mode === "create" && (
        <EventFormDialog
          orgId={orgId}
          timeZone={timeZone}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          event={null}
          defaultStart={dialog.start}
          defaultAllDay={dialog.allDay}
          members={members}
          onSaved={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function shiftDays(date: Date, delta: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + delta);
  return out;
}

/** The month a window is "about": the one its middle day belongs to. */
function midMonth(fromKey: string, dayCount: number): string {
  return addDaysToKey(fromKey, Math.floor(dayCount / 2)).slice(0, 7);
}

/** Today when it is in the month, otherwise the month's first day. */
function anchorDay(monthKey: string, todayKey: string): string {
  return todayKey.slice(0, 7) === monthKey ? todayKey : `${monthKey}-01`;
}

function isTodayInWindow(range: CalendarWindow, todayKey: string, dayCount: number): boolean {
  if (range.view === "dayGridMonth" || range.view === "listMonth") {
    return todayKey.slice(0, 7) === midMonth(range.fromKey, dayCount);
  }
  return todayKey >= range.fromKey && todayKey < range.toKey;
}

const rangeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

function rangeLabel(range: CalendarWindow, monthKey: string, dayCount: number): string {
  if (range.view === "timeGridDay") return longDate(range.fromKey);
  if (range.view === "timeGridWeek") {
    const last = addDaysToKey(range.fromKey, 6);
    const first = rangeFmt.format(new Date(`${range.fromKey}T00:00:00Z`));
    const second = rangeFmt.format(new Date(`${last}T00:00:00Z`));
    return `${first} – ${second}, ${last.slice(0, 4)}`;
  }
  void dayCount;
  return monthLabel(monthKey);
}

function emptyTitle(range: CalendarWindow): string {
  if (range.view === "timeGridDay") return "Nothing on this day";
  if (range.view === "timeGridWeek") return "Nothing this week";
  return "Nothing this month";
}

function prevLabel(view: CalendarView): string {
  if (view === "timeGridWeek") return "Previous week";
  if (view === "timeGridDay") return "Previous day";
  return "Previous month";
}

function nextLabel(view: CalendarView): string {
  if (view === "timeGridWeek") return "Next week";
  if (view === "timeGridDay") return "Next day";
  return "Next month";
}
