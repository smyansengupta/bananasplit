import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { KIND_INK, KIND_META } from "@/components/calendar/kinds";
import type { EventKind } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * Home's "This week" (the plan's mockup): the next seven days as columns.
 * Each event is a block in its kind's colour (the calendar's own colours)
 * with its time and how many are going; each of the viewer's deadlines is a
 * dashed box beside them ("Due: room request"), and an overdue one sits on
 * today in the danger tint. A day with nothing on says "Free evening". A
 * crowded day, or one where two events overlap, is outlined and says
 * "Busy" beside its date, and the page puts the one finding about it under
 * the columns. Each block names its kind for screen readers, not by colour
 * alone. On a phone it is a list, one line per day.
 */

export interface WeekEvent {
  id: string;
  title: string;
  kind: EventKind;
  allDay: boolean;
  /** "7 PM", or "All day". */
  time: string;
  /** Members going, when anyone is. */
  going: number;
}

export interface WeekDeadline {
  id: string;
  title: string;
  href: string;
  overdue: boolean;
}

export interface WeekDay {
  key: string;
  /** "Mon". */
  weekday: string;
  /** "12". */
  date: string;
  isToday: boolean;
  events: WeekEvent[];
  deadlines: WeekDeadline[];
  /** Crowded, or two events overlap: outlined. */
  busy: boolean;
}

function kindVars(kind: EventKind): CSSProperties {
  return { ["--kind" as string]: `var(${KIND_META[kind].token})` };
}

/** Beside a busy day's date: the outline's meaning in words. */
function BusyWord() {
  return <span className="text-tint-danger-foreground text-[11.5px] font-semibold">Busy</span>;
}

function eventLine(e: WeekEvent): string {
  const time = e.allDay ? "" : `${e.time} `;
  return `${time}${e.title}${e.going > 0 ? `, ${e.going} going` : ""}`;
}

export function WeekTimeline({
  orgSlug,
  days,
  insight,
}: {
  orgSlug: string;
  days: readonly WeekDay[];
  /** The one finding under the columns (a crowded or clashing day). */
  insight?: ReactNode;
}) {
  const href = (id: string) => `/app/${orgSlug}/calendar/${id}`;
  const blocks = (d: WeekDay) => (
    <>
      {d.events.map((e) => (
        <Link
          key={e.id}
          href={href(e.id)}
          title={`${e.title}, ${e.time}, ${KIND_META[e.kind].label}`}
          style={{ ...kindVars(e.kind), color: KIND_INK }}
          className="block rounded-[9px] bg-(--kind) px-2 py-1.5 text-[12px] leading-tight font-semibold transition-[filter] hover:brightness-110"
        >
          <span className="line-clamp-2">
            <span className="sr-only">{KIND_META[e.kind].label}: </span>
            {eventLine(e)}
          </span>
        </Link>
      ))}
      {d.deadlines.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          className={cn(
            "block rounded-[9px] px-2 py-1.5 text-[12px] leading-tight font-medium",
            t.overdue
              ? "bg-tint-danger text-tint-danger-foreground"
              : "border-border hover:border-foreground/30 border border-dashed",
          )}
        >
          <span className="line-clamp-2">
            {t.overdue ? `${t.title}, overdue` : `Due: ${t.title}`}
          </span>
        </Link>
      ))}
      {d.events.length === 0 && d.deadlines.length === 0 && (
        <p className="text-muted-foreground text-[12px]">Free evening</p>
      )}
    </>
  );

  return (
    <div className="space-y-4">
      {/* Desktop and tablet: seven columns. */}
      <ol className="grid grid-cols-7 gap-2 max-sm:hidden">
        {days.map((d) => (
          <li
            key={d.key}
            aria-current={d.isToday ? "date" : undefined}
            className={cn(
              "rounded-tile min-w-0 space-y-1.5 p-2.5",
              d.isToday && "bg-muted/60",
              d.busy && "ring-tint-danger-foreground/45 ring-[1.5px] ring-inset",
            )}
          >
            <p className="flex flex-wrap items-baseline gap-x-1.5 pb-1">
              <span className="text-[14px] font-semibold">{d.isToday ? "Today" : d.weekday}</span>
              <span className="text-muted-foreground numeral text-[14px]">{d.date}</span>
              {d.busy && <BusyWord />}
            </p>
            {blocks(d)}
          </li>
        ))}
      </ol>

      {/* Phones: one line per day. */}
      <ol className="space-y-1.5 sm:hidden">
        {days.map((d) => (
          <li
            key={d.key}
            aria-current={d.isToday ? "date" : undefined}
            className={cn(
              "rounded-tile flex items-start gap-3 px-3 py-2.5",
              d.isToday ? "bg-muted" : "bg-muted/50",
              d.busy && "ring-tint-danger-foreground/45 ring-[1.5px] ring-inset",
            )}
          >
            <p className="flex w-16 shrink-0 flex-wrap items-baseline gap-x-1.5 pt-0.5">
              <span className="text-[13px] font-semibold">{d.isToday ? "Today" : d.weekday}</span>
              <span className="text-muted-foreground numeral text-[13px]">{d.date}</span>
              {d.busy && <BusyWord />}
            </p>
            <div className="min-w-0 flex-1 space-y-1.5 self-center">{blocks(d)}</div>
          </li>
        ))}
      </ol>
      {insight}
    </div>
  );
}
