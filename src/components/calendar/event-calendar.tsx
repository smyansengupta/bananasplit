"use client";

import type { DatesSetArg, EventContentArg, EventDropArg } from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, {
  type DateClickArg,
  type EventResizeDoneArg,
} from "@fullcalendar/interaction";
import listPlugin from "@fullcalendar/list";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import { AlertTriangle, CalendarClock, CalendarX2, Globe, Lock } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { moveEvent } from "@/app/app/[orgSlug]/calendar/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CalendarSyncState, EventKind, EventVisibility } from "@/generated/prisma/enums";
import { addDaysToKey } from "@/lib/calendar/dates";
import { calendarSearch, CALENDAR_VIEWS, type CalendarView } from "@/lib/calendar/range";
import { cn } from "@/lib/utils";

import "./calendar.css";
import { EventFormDialog } from "./event-form-dialog";
import { KIND_META, KIND_ORDER, SYNC_META, VISIBILITY_META } from "./kinds";
import type { CalendarMember } from "./member-picker";
import { toDateInputValue } from "./utils";

/** One event on the grid (built on the server; all-day dates are org-timezone days). */
export interface CalendarItem {
  id: string;
  title: string;
  /** Timed: ISO instant. All-day: "YYYY-MM-DD". */
  start: string;
  /** Timed: ISO instant. All-day: the day after the last day (FullCalendar's exclusive end). */
  end: string;
  allDay: boolean;
  kind: EventKind;
  visibility: EventVisibility;
  syncState: CalendarSyncState;
  needsReview: boolean;
}

export interface CalendarWindow {
  fromKey: string;
  toKey: string;
  view: CalendarView;
  kinds: EventKind[];
  visibility: EventVisibility | null;
}

function initialDate(w: CalendarWindow): string {
  // The month grid starts up to six days before the 1st; a week in lands in the month.
  return w.view === "dayGridMonth" ? addDaysToKey(w.fromKey, 7) : w.fromKey;
}

function SyncIcon({ state }: { state: CalendarSyncState }) {
  if (state === "FAILED")
    return <CalendarX2 aria-label={SYNC_META.FAILED.label} className="size-3 shrink-0" />;
  if (state === "PENDING")
    return <CalendarClock aria-label={SYNC_META.PENDING.label} className="size-3 shrink-0" />;
  return null;
}

function renderEventContent(arg: EventContentArg, showSync: boolean) {
  const item = arg.event.extendedProps as Omit<
    CalendarItem,
    "id" | "title" | "start" | "end" | "allDay"
  >;
  const VisIcon = item.visibility === "PUBLIC" ? Globe : Lock;
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden px-0.5 text-xs">
      {!arg.event.allDay && arg.view.type !== "timeGridWeek" && arg.view.type !== "timeGridDay" && (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: KIND_META[item.kind].color }}
        />
      )}
      {arg.timeText && !arg.event.allDay && (
        <span className="shrink-0 opacity-80">{arg.timeText}</span>
      )}
      <VisIcon
        aria-label={VISIBILITY_META[item.visibility].label}
        className="size-3 shrink-0 opacity-80"
      />
      {showSync && <SyncIcon state={item.syncState} />}
      {item.needsReview && (
        <AlertTriangle aria-label="Possible duplicate" className="size-3 shrink-0" />
      )}
      <span className="truncate font-medium">{arg.event.title}</span>
    </span>
  );
}

export function EventCalendar({
  orgId,
  timeZone,
  items,
  members,
  canManage,
  window: range,
  orgSlug,
}: {
  orgId: string;
  orgSlug: string;
  timeZone: string;
  items: CalendarItem[];
  members: CalendarMember[];
  /** OWNER/ADMIN: create, drag, resize, edit (the server re-checks every write). */
  canManage: boolean;
  window: CalendarWindow;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [defaultStart, setDefaultStart] = useState<Date | null>(null);
  const [defaultAllDay, setDefaultAllDay] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  function navigate(next: CalendarWindow) {
    const search = calendarSearch(next);
    if (search === calendarSearch(range)) return;
    startTransition(() => router.replace(`${pathname}?${search}`, { scroll: false }));
  }

  function onDatesSet(arg: DatesSetArg) {
    const view = (CALENDAR_VIEWS as readonly string[]).includes(arg.view.type)
      ? (arg.view.type as CalendarView)
      : "dayGridMonth";
    navigate({
      ...range,
      fromKey: toDateInputValue(arg.start),
      toKey: toDateInputValue(arg.end),
      view,
    });
  }

  function toggleKind(kind: EventKind) {
    const kinds = range.kinds.includes(kind)
      ? range.kinds.filter((k) => k !== kind)
      : [...range.kinds, kind];
    navigate({ ...range, kinds: KIND_ORDER.filter((k) => kinds.includes(k)) });
  }

  function openNewEvent(start?: Date, allDay = false) {
    setDefaultStart(start ?? null);
    setDefaultAllDay(allDay);
    setDialogOpen(true);
  }

  function onDateClick(info: DateClickArg) {
    if (!canManage) return;
    if (info.allDay && info.view.type === "dayGridMonth") {
      // A day cell: most events are evenings, so start with 6pm that day.
      const at = new Date(info.date);
      at.setHours(18, 0, 0, 0);
      openNewEvent(at, false);
    } else {
      openNewEvent(info.date, info.allDay);
    }
  }

  function persistMove(info: EventDropArg | EventResizeDoneArg) {
    const e = info.event;
    if (!e.start) return info.revert();
    setMoveError(null);
    const times = e.allDay
      ? {
          allDay: true,
          startsAt: e.startStr.slice(0, 10),
          endsAt: e.endStr ? addDaysToKey(e.endStr.slice(0, 10), -1) : e.startStr.slice(0, 10),
        }
      : {
          allDay: false,
          startsAt: e.start.toISOString(),
          endsAt: (e.end ?? new Date(e.start.getTime() + 60 * 60 * 1000)).toISOString(),
        };
    moveEvent(orgId, e.id, times).then((result) => {
      if (result?.error) {
        setMoveError(result.error);
        info.revert();
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Filter by type"
        >
          {KIND_ORDER.map((kind) => {
            const active = range.kinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                onClick={() => toggleKind(kind)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  active
                    ? "border-foreground/40 bg-muted font-medium"
                    : "text-muted-foreground hover:bg-muted/60",
                )}
              >
                <span
                  aria-hidden
                  className="size-2 rounded-full"
                  style={{ backgroundColor: KIND_META[kind].color }}
                />
                {KIND_META[kind].label}
              </button>
            );
          })}
        </div>
        <Select
          value={range.visibility ?? "ALL"}
          onValueChange={(v) =>
            navigate({ ...range, visibility: v === "ALL" ? null : (v as EventVisibility) })
          }
        >
          <SelectTrigger size="sm" className="w-40" aria-label="Filter by visibility">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Public and internal</SelectItem>
            <SelectItem value="PUBLIC">Public only</SelectItem>
            <SelectItem value="INTERNAL">Internal only</SelectItem>
          </SelectContent>
        </Select>
        {isPending && <span className="text-muted-foreground text-xs">Loading…</span>}
        {canManage && (
          <Button type="button" className="ml-auto" onClick={() => openNewEvent()}>
            New event
          </Button>
        )}
      </div>

      {moveError && (
        <p className="text-destructive text-sm" role="alert">
          {moveError}
        </p>
      )}

      <div className={cn("cbc-calendar transition-opacity", isPending && "opacity-60")}>
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={range.view}
          initialDate={initialDate(range)}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listMonth",
          }}
          height="auto"
          dayMaxEvents={4}
          // Only admins edit; the server re-checks every move.
          editable={canManage}
          eventStartEditable={canManage}
          eventDurationEditable={canManage}
          selectable={false}
          events={items.map((item) => ({
            id: item.id,
            title: item.title,
            start: item.start,
            end: item.end,
            allDay: item.allDay,
            backgroundColor: KIND_META[item.kind].color,
            borderColor: KIND_META[item.kind].color,
            textColor: "white",
            classNames: [
              item.visibility === "INTERNAL" ? "cbc-event-internal" : "cbc-event-public",
            ],
            extendedProps: {
              kind: item.kind,
              visibility: item.visibility,
              syncState: item.syncState,
              needsReview: item.needsReview,
            },
          }))}
          eventContent={(arg) => renderEventContent(arg, canManage)}
          datesSet={onDatesSet}
          dateClick={onDateClick}
          eventClick={(info) => {
            info.jsEvent.preventDefault();
            router.push(`/app/${orgSlug}/calendar/${info.event.id}`);
          }}
          eventDrop={persistMove}
          eventResize={persistMove}
        />
      </div>

      <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1">
          <Globe className="size-3" aria-hidden /> Public: on the website
        </span>
        <span className="flex items-center gap-1">
          <Lock className="size-3" aria-hidden /> Internal: board and members only
        </span>
        {canManage && (
          <>
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden /> Syncing to Google
            </span>
            <span className="flex items-center gap-1">
              <CalendarX2 className="size-3" aria-hidden /> Google sync failed
            </span>
          </>
        )}
        <span>Times shown in your timezone; all-day events are days in {timeZone}.</span>
      </div>

      {canManage && (
        <EventFormDialog
          orgId={orgId}
          timeZone={timeZone}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          event={null}
          defaultStart={defaultStart}
          defaultAllDay={defaultAllDay}
          members={members}
        />
      )}
    </div>
  );
}
