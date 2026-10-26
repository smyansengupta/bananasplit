"use client";

import {
  CalendarClock,
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  Globe,
} from "@/components/icons";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { moveEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { calendarSearch, NEW_EVENT_PARAM, type CalendarView } from "@/lib/calendar/range";
import { cn } from "@/lib/utils";

import { AgendaList } from "./agenda-list";
import "./calendar.css";
import { useTodayKey } from "./hooks";
import { anchorFor, EventPeek, type PeekAnchor } from "./event-peek";
import type { EventFormEvent } from "./event-form-dialog";
import type { CalendarItem } from "./item";
import { KIND_META, KIND_ORDER, kindStyle } from "./kinds";
import { CALENDAR_CREATE_EVENT, type CalendarCreateDetail } from "./new-event-button";
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
  /** Tasks' due dates drawn beside the events. */
  tasks: boolean;
}

/** Loaded on demand: nobody who is only reading the calendar pays for the form. */
const EventFormDialog = dynamic(
  () => import("./event-form-dialog").then((m) => m.EventFormDialog),
  { ssr: false },
);

/** "From a screenshot" (under New event): also loaded only when used. */
const CalendarShotImport = dynamic(
  () => import("@/components/ai/calendar-shot-import").then((m) => m.CalendarShotImport),
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
  tasksLayer = true,
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
  /** Whether the plan has the Tasks layer (and so its filter button). */
  tasksLayer?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  // ?new=1 (the create menu's "New event") and ?new=rsvp (the RSVPs page's
  // "New event", its RSVP page switched on) arrive with New event
  // open. The state is adjusted while rendering, not in an effect, so it
  // also works when the calendar is already on screen.
  const asked = canManage ? searchParams.get(NEW_EVENT_PARAM) : null;
  const askedNew = asked === "1" || asked === "rsvp" ? asked : null;
  const [peek, setPeek] = useState<PeekAnchor | null>(null);
  const [dialog, setDialog] = useState<
    | { mode: "create"; start: Date | null; allDay: boolean; rsvp?: boolean }
    | { mode: "edit"; event: EventFormEvent }
    | null
  >(() =>
    askedNew ? { mode: "create", start: null, allDay: false, rsvp: askedNew === "rsvp" } : null,
  );
  const [openedNew, setOpenedNew] = useState(askedNew);
  if (askedNew !== openedNew) {
    setOpenedNew(askedNew);
    if (askedNew) {
      setPeek(null);
      setDialog({ mode: "create", start: null, allDay: false, rsvp: askedNew === "rsvp" });
    }
  }

  // Then drop the param, so a reload or Back doesn't open another.
  useEffect(() => {
    if (!askedNew) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete(NEW_EVENT_PARAM);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }, [askedNew, searchParams, router, pathname]);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const [shotOpen, setShotOpen] = useState(false);

  // Today is read in the org timezone on the server so the first paint
  // matches, then swapped for the viewer's own day on hydration.
  const todayKey = useTodayKey(orgTodayKey);

  const dayCount = windowDays(range.fromKey, range.toKey);
  const monthKey = useMemo(
    () =>
      range.view === "timeGridWeek" || range.view === "timeGridDay"
        ? range.fromKey.slice(0, 7)
        : midMonth(range.fromKey, dayCount),
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
    const anchor =
      range.view === "dayGridMonth" || range.view === "listMonth"
        ? anchorDay(monthKey, todayKey)
        : range.fromKey;
    if (view === "timeGridWeek") navigate({ ...range, view, ...weekWindowFor(anchor) });
    else if (view === "timeGridDay") navigate({ ...range, view, ...dayWindowFor(anchor) });
    else navigate({ ...range, view, ...monthWindowFor(anchor.slice(0, 7)) });
  }

  function toggleKind(kind: EventKind) {
    const kinds = range.kinds.includes(kind)
      ? range.kinds.filter((k) => k !== kind)
      : [...range.kinds, kind];
    navigate({ ...range, kinds: KIND_ORDER.filter((k) => kinds.includes(k)) });
  }

  const openPeek = useCallback(
    (item: CalendarItem, chip: HTMLElement) => {
      // A task's due date opens the task itself.
      if (item.task) {
        router.push(`/app/${orgSlug}/tasks/${item.id}`);
        return;
      }
      const wrap = wrapRef.current;
      if (!wrap) return;
      setPeek((current) => (current?.id === item.id ? null : anchorFor(chip, wrap, item.id)));
    },
    [orgSlug, router],
  );

  function openCreate(start: Date | null, allDay = false) {
    setPeek(null);
    setDialog({ mode: "create", start, allDay });
  }

  // The page header's New event (new-event-button.tsx) asks for a dialog.
  useEffect(() => {
    if (!canManage) return;
    const onAsk = (e: Event) => {
      const from = (e as CustomEvent<CalendarCreateDetail>).detail?.from;
      setPeek(null);
      if (from === "screenshot") setShotOpen(true);
      else setDialog({ mode: "create", start: null, allDay: false });
    };
    window.addEventListener(CALENDAR_CREATE_EVENT, onAsk);
    return () => window.removeEventListener(CALENDAR_CREATE_EVENT, onAsk);
  }, [canManage]);

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
    ? (item: CalendarItem) =>
        item.task
          ? {}
          : {
              draggable: true,
              onDragStart: (event: React.DragEvent) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
                setDrag({ id: item.id, over: null });
              },
              onDragEnd: () => setDrag(null),
            }
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
    const item = items.find((i) => i.id === id && !i.task);
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

  const openItem = peek ? (items.find((i) => i.id === peek.id && !i.task) ?? null) : null;
  const count = items.length;
  const eventCount = items.filter((i) => !i.task).length;
  const taskCount = count - eventCount;
  const countLabel =
    count === 0
      ? "Nothing scheduled"
      : [
          eventCount > 0 && (eventCount === 1 ? "1 event" : `${eventCount} events`),
          taskCount > 0 && (taskCount === 1 ? "1 task due" : `${taskCount} tasks due`),
        ]
          .filter(Boolean)
          .join(" · ");

  const filtered = range.kinds.length > 0 || Boolean(range.visibility);
  const emptyState = (
    <EmptyState
      icon={CalendarDays}
      title={emptyTitle(range)}
      description={
        filtered
          ? "No event here matches the filters. Clear them to see everything in this window."
          : canManage
            ? "Add a meeting, a social or any event. It shows here, and on your website if you make it public."
            : "Sessions the board schedules show up here. You'll be notified when you're invited to one."
      }
      action={
        filtered ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate({ ...range, kinds: [], visibility: null })}
          >
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <div className="cal space-y-4">
      <div className="cal-head">
        <div className="cal-head__label">
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              onClick={() => step(-1)}
              aria-label={prevLabel(range.view)}
            >
              <ChevronLeft aria-hidden className="size-5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => step(1)}
              aria-label={nextLabel(range.view)}
            >
              <ChevronRight aria-hidden className="size-5" />
            </Button>
          </div>
          <div className="min-w-0">
            <h2 className="cal-head__month">{rangeLabel(range, monthKey, dayCount)}</h2>
            <p className="cal-head__count">
              {countLabel}
              {isPending && <span className="ml-2 opacity-70">Loading…</span>}
            </p>
          </div>
        </div>

        {/*
          Today and the view switcher sit at the right, where New event used
          to be (it's in the page header now, beside Google Calendar sync).
          On a phone it is the switcher alone, spanning the width, its names
          centred: the arrows step back and forth, and Today is a computer
          thing.
        */}
        <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto">
          <Button
            variant="outline"
            className="max-md:hidden"
            onClick={goToday}
            disabled={isTodayInWindow(range, todayKey, dayCount)}
          >
            Today
          </Button>

          <Segmented
            label="Calendar view"
            className="order-last w-full md:order-none md:w-auto [&>*]:flex-1 max-md:[&>*]:justify-center md:[&>*]:flex-none"
            value={range.view}
            onSelect={(v) => setView(v as CalendarView)}
            options={VIEW_LABELS.map(({ view, label }) => ({ value: view, label }))}
          />
        </div>
      </div>

      <div className="-mx-1 [scrollbar-width:none] overflow-x-auto px-1 pb-0.5 [&::-webkit-scrollbar]:hidden">
        <div className="cal-filters">
          {tasksLayer && (
            <>
              <button
                type="button"
                className="cal-filter"
                data-task="open"
                style={{ ["--kind" as string]: "var(--primary)" }}
                aria-pressed={range.tasks}
                title={range.tasks ? "Hide tasks' due dates" : "Show tasks' due dates"}
                onClick={() => navigate({ ...range, tasks: !range.tasks })}
              >
                <span aria-hidden className="cal-chip__dot" />
                Tasks
              </button>
              <span aria-hidden className="bg-border mx-1 h-5 w-px shrink-0" />
            </>
          )}
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
            onValueChange={(v) =>
              navigate({ ...range, visibility: v === "ALL" ? null : (v as EventVisibility) })
            }
          >
            <SelectTrigger
              size="sm"
              className="w-auto min-w-38 shrink-0"
              aria-label="Filter by visibility"
            >
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
            onShowDay={(dayKey) =>
              navigate({ ...range, view: "timeGridDay", ...dayWindowFor(dayKey) })
            }
            canManage={canManage}
            showSync={canManage}
            dropDayKey={drag?.over ?? null}
            draggingId={drag?.id ?? null}
            chipProps={dragProps}
            dayProps={dayDropProps}
          />
        )}

        {/*
          On a phone the month's chips are colour bars with no room for a
          title, so the month's events follow the grid as a list you can
          read (the List view's), the way phone calendars pair the two.
        */}
        {range.view === "dayGridMonth" && count > 0 && (
          <section className="mt-6 md:hidden" aria-labelledby="cal-month-list">
            <h2
              id="cal-month-list"
              className="text-muted-foreground mb-1 px-1 text-[13px] font-semibold"
            >
              This month
            </h2>
            <AgendaList
              items={items}
              fromKey={range.fromKey}
              dayCount={dayCount}
              todayKey={todayKey}
              openId={peek?.id ?? null}
              onOpen={openPeek}
              showSync={canManage}
              emptyState={null}
            />
          </section>
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

      {count === 0 && range.view !== "listMonth" && <div className="cal-agenda">{emptyState}</div>}

      <div className="cal-legend">
        <span className="cal-legend__item">
          <Globe aria-hidden className="size-3.5" /> Public: on the website
        </span>
        <span className="cal-legend__item">
          <span aria-hidden className="cal-legend__pill" data-internal="true" />
          Internal: board and members only
        </span>
        <span className="cal-legend__item">
          <span aria-hidden className="cal-legend__pill" data-rsvp="yes" />
          Solid: you&apos;re going
        </span>
        {canManage && (
          <>
            <span className="cal-legend__item">
              <CalendarClock aria-hidden className="size-3.5" /> Syncing to Google
            </span>
            <span className="cal-legend__item">
              <CalendarX2 aria-hidden className="size-3.5" /> Google sync failed
            </span>
          </>
        )}
        <span>Times are in your timezone; all-day events are whole days in {timeZone}.</span>
        {canManage && (
          <span className="hidden md:inline">Drag an event in the month grid to move it.</span>
        )}
      </div>

      {canManage && shotOpen && (
        <CalendarShotImport
          orgId={orgId}
          orgSlug={orgSlug}
          open={shotOpen}
          onOpenChange={setShotOpen}
        />
      )}

      {canManage && dialog?.mode === "create" && (
        <EventFormDialog
          orgId={orgId}
          timeZone={timeZone}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          event={null}
          defaultStart={dialog.start}
          defaultAllDay={dialog.allDay}
          defaultRsvpPage={dialog.rsvp}
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

const rangeFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

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
