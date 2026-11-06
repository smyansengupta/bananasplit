"use client";

import type { MeetingType } from "@/lib/meetings/meeting-types";
import { CalendarDays, ChevronLeft, ChevronRight, Globe, Lock } from "@/components/icons";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { loadEventForEdit, moveEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { updateTask } from "@/app/app/[orgSlug]/tasks/actions";
import { AmbientActions } from "@/components/ambient/ambient-button";
import { toast } from "@/components/ui/toaster";
import { firstClash } from "@/lib/ambient/calendar";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { FiltersMenu } from "@/components/ui/toolbar-chips";
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
import { newMeetingAsk, shapeFromParam, type MeetingShape } from "@/lib/meetings/shape";
import { cn } from "@/lib/utils";

import { AgendaList } from "./agenda-list";
import "./calendar.css";
import { useTodayKey } from "./hooks";
import { EventPeek } from "./event-peek";
import type { EventFormEvent } from "./event-form-dialog";
import type { CalendarItem } from "./item";
import { KIND_META, KIND_ORDER, kindStyle, VISIBILITY_META } from "./kinds";
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
  defaultReminderMinutes,
  meetingTypes,
}: {
  orgId: string;
  orgSlug: string;
  timeZone: string;
  /** The organization's reminder times, which a new event starts with. */
  defaultReminderMinutes?: number[];
  /** The organization's meeting types, offered on a new event. */
  meetingTypes?: MeetingType[];
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

  // ?new=1 (the create menu's "New event") arrives with New event open, and
  // so does ?new=online|in-person|event (or the old ?new=rsvp, an event) on
  // that shape. The state is adjusted while rendering, not in an effect, so
  // it also works when the calendar is already on screen.
  const asked = canManage ? searchParams.get(NEW_EVENT_PARAM) : null;
  const askedNew = newMeetingAsk(asked) ? asked : null;
  const askedShape = shapeFromParam(askedNew) ?? undefined;
  // The event whose detail is open (a centred dialog, event-peek.tsx).
  const [peek, setPeek] = useState<{ id: string } | null>(null);
  const [dialog, setDialog] = useState<
    | {
        mode: "create";
        start: Date | null;
        end?: Date | null;
        allDay: boolean;
        shape?: MeetingShape;
      }
    | { mode: "edit"; event: EventFormEvent }
    | null
  >(() => (askedNew ? { mode: "create", start: null, allDay: false, shape: askedShape } : null));
  const [openedNew, setOpenedNew] = useState(askedNew);
  if (askedNew !== openedNew) {
    setOpenedNew(askedNew);
    if (askedNew) {
      setPeek(null);
      setDialog({ mode: "create", start: null, allDay: false, shape: askedShape });
    }
  }

  // Then drop the param, so a reload or Back doesn't open another. Only the
  // address changes: a router navigation would swap the page for its
  // loading skeleton behind the open dialog.
  useEffect(() => {
    if (!askedNew) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete(NEW_EVENT_PARAM);
    const search = params.toString();
    window.history.replaceState(null, "", search ? `${pathname}?${search}` : pathname);
  }, [askedNew, searchParams, pathname]);
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
    (item: CalendarItem) => {
      // A task's due date opens the task itself.
      if (item.task) {
        router.push(`/app/${orgSlug}/tasks/${item.id}`);
        return;
      }
      setPeek({ id: item.id });
    },
    [orgSlug, router],
  );

  function openCreate(start: Date | null, allDay = false, end: Date | null = null) {
    setPeek(null);
    setDialog({ mode: "create", start, end, allDay });
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

  /**
   * Edit opens the form right here, over the calendar, instead of going to
   * the event's page: the grid carries a summary, so the whole event is
   * loaded first (a moment), then the same form the page uses opens.
   */
  function openEdit(item: CalendarItem) {
    setPeek(null);
    startTransition(async () => {
      const result = await loadEventForEdit(orgId, item.id);
      if ("event" in result && result.event) setDialog({ mode: "edit", event: result.event });
      else
        toast({ title: ("error" in result && result.error) || "Couldn't open it", tone: "error" });
    });
  }

  /**
   * Saves a move or a resize, and offers Undo: a drag is easy to make by
   * accident, so taking it back is one click.
   */
  function applyMove(
    id: string,
    times: { allDay: boolean; startsAt: string; endsAt: string },
    before: { allDay: boolean; startsAt: string; endsAt: string },
  ) {
    setMoveError(null);
    startTransition(async () => {
      const result = await moveEvent(orgId, id, times);
      if (result?.error) {
        setMoveError(result.error);
        return;
      }
      router.refresh();
      toast({
        title: "Moved",
        action: {
          label: "Undo",
          run: async () => {
            const back = await moveEvent(orgId, id, before);
            if (back?.error) return back.error;
            router.refresh();
          },
        },
      });
    });
  }

  /** A task chip dropped on another day: its due date moves, with Undo. */
  function moveTaskDue(task: CalendarItem, dayKey: string) {
    const before = task.start;
    setMoveError(null);
    startTransition(async () => {
      const result = await updateTask(orgId, task.id, { dueDate: dayKey });
      if (result && "error" in result && result.error) {
        setMoveError(result.error);
        return;
      }
      router.refresh();
      toast({
        title: "Due date moved",
        action: {
          label: "Undo",
          run: async () => {
            const back = await updateTask(orgId, task.id, { dueDate: before });
            if (back && "error" in back && back.error) return back.error;
            router.refresh();
          },
        },
      });
    });
  }

  /** The week grid's drag or resize: new start and end, same day or another. */
  function moveTimed(item: CalendarItem, startsAt: Date, endsAt: Date) {
    if (item.task || item.allDay) return;
    if (startsAt.toISOString() === item.start && endsAt.toISOString() === item.end) return;
    applyMove(
      item.id,
      { allDay: false, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      { allDay: false, startsAt: item.start, endsAt: item.end },
    );
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
        // A task drags too: dropping it on a day moves its due date.
        ({
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
    const task = items.find((i) => i.id === id && i.task);
    if (task) {
      if (task.start !== dayKey) moveTaskDue(task, dayKey);
      return;
    }
    const item = items.find((i) => i.id === id && !i.task);
    if (!item) return;
    const firstDay = item.allDay ? item.start : localDayKey(new Date(item.start));
    if (firstDay === dayKey) return;
    const delta = Math.round(
      (Date.parse(`${dayKey}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000,
    );
    const before = item.allDay
      ? { allDay: true, startsAt: item.start, endsAt: addDaysToKey(item.end, -1) }
      : { allDay: false, startsAt: item.start, endsAt: item.end };
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
    applyMove(id, times, before);
  }

  const openItem = peek ? (items.find((i) => i.id === peek.id && !i.task) ?? null) : null;
  const count = items.length;

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
      {/*
        One bar, as on Tasks: the view first, then the arrows, Today and
        where you are, and one Filters chip (task due dates, the kinds of
        event, public or internal) at the right. On a phone the view switch
        spans the width under the rest, and Today is a computer thing.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Calendar view"
          className="order-last w-full md:order-none md:w-auto [&>*]:flex-1 max-md:[&>*]:justify-center md:[&>*]:flex-none"
          value={range.view}
          onSelect={(v) => setView(v as CalendarView)}
          options={VIEW_LABELS.map(({ view, label }) => ({ value: view, label }))}
        />
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
          <Button
            variant="outline"
            className="max-md:hidden"
            onClick={goToday}
            disabled={isTodayInWindow(range, todayKey, dayCount)}
          >
            Today
          </Button>
        </div>
        <div className="min-w-0 px-1">
          <h2 className="cal-head__month">{rangeLabel(range, monthKey, dayCount)}</h2>
          {isPending && <p className="cal-head__count opacity-70">Loading…</p>}
        </div>
        <div className="ms-auto">
          <FiltersMenu
            count={
              range.kinds.length + (range.visibility ? 1 : 0) + (tasksLayer && !range.tasks ? 1 : 0)
            }
            items={[
              ...(tasksLayer
                ? [
                    {
                      name: "Show",
                      node: (
                        <div className="flex justify-start!">
                          <button
                            type="button"
                            className="cal-filter"
                            data-task="open"
                            style={{ ["--kind" as string]: "var(--primary)" }}
                            aria-pressed={range.tasks}
                            onClick={() => navigate({ ...range, tasks: !range.tasks })}
                          >
                            <span aria-hidden className="cal-chip__dot" />
                            Task due dates
                          </button>
                        </div>
                      ),
                    },
                  ]
                : []),
              {
                name: "Type",
                node: (
                  <div
                    className="flex flex-wrap justify-start! gap-1.5"
                    role="group"
                    aria-label="Filter by type"
                  >
                    {KIND_ORDER.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className="cal-filter"
                        style={kindStyle(kind)}
                        aria-pressed={range.kinds.includes(kind)}
                        onClick={() => toggleKind(kind)}
                      >
                        <span aria-hidden className="cal-filter__dot" />
                        {KIND_META[kind].label}
                      </button>
                    ))}
                  </div>
                ),
              },
              {
                name: "Who can see it",
                node: (
                  /* Two chips, not a menu: either narrows to it; again (or neither) is both. */
                  <div className="flex flex-wrap justify-start! gap-1.5">
                    {(["PUBLIC", "INTERNAL"] as const).map((v) => {
                      const active = range.visibility === v;
                      return (
                        <button
                          key={v}
                          type="button"
                          className="cal-filter"
                          aria-pressed={active}
                          onClick={() => navigate({ ...range, visibility: active ? null : v })}
                        >
                          {v === "PUBLIC" ? (
                            <Globe aria-hidden className="size-3.5" />
                          ) : (
                            <Lock aria-hidden className="size-3.5" />
                          )}
                          {VISIBILITY_META[v].label}
                        </button>
                      );
                    })}
                  </div>
                ),
              },
            ]}
          />
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

        {range.view === "timeGridWeek" && canManage && (
          <WeekClash orgSlug={orgSlug} items={items} />
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
            onMove={canManage ? moveTimed : undefined}
            onCreate={canManage ? (start, end) => openCreate(start, false, end) : undefined}
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
            orgId={orgId}
            item={openItem}
            orgSlug={orgSlug}
            canManage={canManage}
            showSync={canManage}
            onClose={() => setPeek(null)}
            onEdit={openEdit}
          />
        )}
      </div>

      {count === 0 && range.view !== "listMonth" && <div className="cal-agenda">{emptyState}</div>}

      {/* One line: what the marks mean, and whose clock the times are on. */}
      <div className="cal-legend">
        <span className="cal-legend__item">
          <Globe aria-hidden className="size-3.5" /> Public
        </span>
        <span className="cal-legend__item">
          <span aria-hidden className="cal-legend__pill" data-rsvp="yes" />
          Solid = going
        </span>
        <span>Times in your zone</span>
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
          defaultEnd={dialog.end ?? null}
          defaultAllDay={dialog.allDay}
          defaultShape={dialog.shape}
          defaultReminderMinutes={defaultReminderMinutes}
          meetingTypes={meetingTypes}
          members={members}
          onSaved={() => setDialog(null)}
        />
      )}

      {canManage && dialog?.mode === "edit" && (
        <EventFormDialog
          orgId={orgId}
          timeZone={timeZone}
          open
          onOpenChange={(open) => !open && setDialog(null)}
          event={dialog.event}
          defaultReminderMinutes={defaultReminderMinutes}
          meetingTypes={meetingTypes}
          members={members}
          onSaved={() => setDialog(null)}
          onDeleted={() => setDialog(null)}
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

/**
 * Two events this week overlap: Move one opens the later one's form, where
 * its time is chosen (src/lib/ambient/calendar.ts picks the pair).
 */
function WeekClash({ orgSlug, items }: { orgSlug: string; items: CalendarItem[] }) {
  const clash = firstClash(
    items
      .filter((i) => !i.task)
      .map((i) => ({
        id: i.id,
        title: i.title,
        allDay: i.allDay,
        startsAt: new Date(i.start),
        endsAt: new Date(i.end),
      })),
  );
  if (!clash) return null;
  const reason = `${clash.keep.title} and ${clash.move.title} overlap`;
  return (
    <AmbientActions
      why
      className="mb-3 items-start"
      actions={[
        {
          key: "move-one",
          label: "Move one",
          reason,
          ariaLabel: `Move ${clash.move.title}`,
          href: `/app/${orgSlug}/meetings/${clash.move.id}?edit=1`,
        },
      ]}
    />
  );
}
