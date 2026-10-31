import Link from "next/link";
import type { CSSProperties } from "react";

import { KIND_INK, KIND_META, KIND_ORDER } from "@/components/calendar/kinds";
import type { EventKind } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * Home's "This week": the next seven days as a small calendar. Each day is
 * a column on one time scale, each event a block in its kind's colour
 * (the calendar's own colours), placed at its time and as tall as it runs.
 * Today's column is tinted with a line at the current time. A legend under
 * it names the kinds on show, so colour is never the only cue. On a phone
 * it is a list, one line per day.
 */

export interface WeekEvent {
  id: string;
  title: string;
  kind: EventKind;
  allDay: boolean;
  /** "7:00 PM", or "All day". */
  time: string;
  /** Minutes after the day's midnight, in the viewer's zone (0 for all day). */
  start: number;
  end: number;
}

export interface WeekDay {
  key: string;
  /** "Mon". */
  weekday: string;
  /** "12". */
  date: string;
  isToday: boolean;
  events: WeekEvent[];
}

const HOUR = 60;
/** With nothing timed this week, the scale shows 9 AM to 9 PM. */
const EMPTY_START = 9 * HOUR;
const EMPTY_END = 21 * HOUR;
/** The scale fits the week's events with an hour either side, and spans at least this. */
const MIN_SPAN = 8 * HOUR;
const BODY_HEIGHT = 264;
/** A short event is still tall enough for its title and time. */
const MIN_BLOCK_PX = 40;

function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / HOUR) % 24;
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function kindVars(kind: EventKind): CSSProperties {
  return { ["--kind" as string]: `var(${KIND_META[kind].token})` };
}

/** Side-by-side lanes for events that overlap in time, greedy in start order. */
function lanes(events: readonly WeekEvent[]): { event: WeekEvent; lane: number; of: number }[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || b.end - a.end);
  const ends: number[] = [];
  const placed = sorted.map((event) => {
    let lane = ends.findIndex((end) => end <= event.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = Math.max(event.end, event.start + 30);
    return { event, lane };
  });
  return placed.map((p) => ({ ...p, of: ends.length }));
}

export function WeekTimeline({
  orgSlug,
  days,
  nowMinutes,
}: {
  orgSlug: string;
  days: readonly WeekDay[];
  /** Minutes after midnight now, in the viewer's zone (for today's line). */
  nowMinutes: number;
}) {
  const timed = days.flatMap((d) => d.events.filter((e) => !e.allDay));
  let start = EMPTY_START;
  let end = EMPTY_END;
  if (timed.length > 0) {
    start = Math.max(0, Math.floor(Math.min(...timed.map((e) => e.start)) / HOUR) * HOUR - HOUR);
    end = Math.min(
      24 * HOUR,
      Math.ceil(Math.max(...timed.map((e) => Math.max(e.end, e.start + HOUR))) / HOUR) * HOUR +
        HOUR,
    );
    // Too short a window: grow it, earlier first (evenings are when things happen).
    if (end - start < MIN_SPAN) start = Math.max(0, end - MIN_SPAN);
    if (end - start < MIN_SPAN) end = Math.min(24 * HOUR, start + MIN_SPAN);
  }
  const span = Math.max(HOUR, end - start);
  const at = (m: number) => ((Math.min(Math.max(m, start), start + span) - start) / span) * 100;
  const step = span > 14 * HOUR ? 4 * HOUR : span > 9 * HOUR ? 3 * HOUR : 2 * HOUR;
  const ticks: number[] = [];
  for (let m = Math.ceil(start / step) * step; m < start + span; m += step) ticks.push(m);
  const anyAllDay = days.some((d) => d.events.some((e) => e.allDay));
  const kinds = KIND_ORDER.filter((k) => days.some((d) => d.events.some((e) => e.kind === k)));
  const total = days.reduce((n, d) => n + d.events.length, 0);
  const href = (id: string) => `/app/${orgSlug}/calendar/${id}`;

  return (
    <div className="space-y-4">
      {/* Desktop and tablet: the seven columns on one time scale. */}
      <div className="grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] max-sm:hidden">
        <span />
        {days.map((d) => (
          <div key={d.key} className="flex justify-center pb-2.5">
            <span
              aria-current={d.isToday ? "date" : undefined}
              className={cn(
                "inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1",
                d.isToday && "bg-brand-accent text-brand-accent-foreground",
              )}
            >
              <span
                className={cn("text-[12.5px] font-medium", !d.isToday && "text-muted-foreground")}
              >
                {d.isToday ? "Today" : d.weekday}
              </span>
              <span className="numeral text-[17px] leading-none">{d.date}</span>
            </span>
          </div>
        ))}

        {anyAllDay && (
          <>
            <span className="text-muted-foreground self-center pr-2 text-right text-[11px]">
              All day
            </span>
            {days.map((d) => (
              <div key={d.key} className="space-y-1 px-[3px] pb-2">
                {d.events
                  .filter((e) => e.allDay)
                  .map((e) => (
                    <Link
                      key={e.id}
                      href={href(e.id)}
                      style={{ ...kindVars(e.kind), color: KIND_INK }}
                      className="block truncate rounded-[7px] bg-(--kind) px-2 py-1 text-[11.5px] font-semibold hover:brightness-110"
                    >
                      {e.title}
                    </Link>
                  ))}
              </div>
            ))}
          </>
        )}

        {/* The hour labels. */}
        <div className="relative" style={{ height: BODY_HEIGHT }}>
          {ticks.map((m) => (
            <span
              key={m}
              className="text-muted-foreground absolute right-2 -translate-y-1/2 text-[11px] tabular-nums"
              style={{ top: `${at(m)}%` }}
            >
              {hourLabel(m)}
            </span>
          ))}
        </div>
        {days.map((d) => {
          const placed = lanes(d.events.filter((e) => !e.allDay));
          const nowIn = d.isToday && nowMinutes >= start && nowMinutes <= start + span;
          return (
            <div
              key={d.key}
              className={cn(
                "border-border/70 relative border-l",
                d.isToday && "bg-brand-accent/[0.06]",
              )}
              style={{ height: BODY_HEIGHT }}
            >
              {ticks.map((m) => (
                <span
                  key={m}
                  aria-hidden="true"
                  className="border-border/60 absolute inset-x-0 border-t border-dashed"
                  style={{ top: `${at(m)}%` }}
                />
              ))}
              {placed.length === 0 && !d.events.some((e) => e.allDay) && (
                <span className="text-muted-foreground/70 absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[11.5px]">
                  Free
                </span>
              )}
              {placed.map(({ event: e, lane, of }) => {
                const top = Math.min(at(e.start), 100 - (MIN_BLOCK_PX / BODY_HEIGHT) * 100);
                const height = Math.max(
                  at(e.end) - at(e.start),
                  (MIN_BLOCK_PX / BODY_HEIGHT) * 100,
                );
                return (
                  <Link
                    key={e.id}
                    href={href(e.id)}
                    title={`${e.title}, ${e.time}, ${KIND_META[e.kind].label}`}
                    style={{
                      ...kindVars(e.kind),
                      color: KIND_INK,
                      top: `${top}%`,
                      height: `${height}%`,
                      left: `calc(${(lane / of) * 100}% + 3px)`,
                      width: `calc(${100 / of}% - 6px)`,
                    }}
                    className="absolute overflow-hidden rounded-[9px] bg-(--kind) px-2 py-1.5 text-[11.5px] leading-tight shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-[filter,transform] hover:z-10 hover:brightness-110 motion-safe:hover:scale-[1.02]"
                  >
                    <span className="line-clamp-2 font-semibold">{e.title}</span>
                    <span className="mt-0.5 block truncate opacity-80">{e.time}</span>
                  </Link>
                );
              })}
              {nowIn && (
                <span
                  aria-hidden="true"
                  className="bg-brand-accent pointer-events-none absolute inset-x-0 z-20 h-0.5"
                  style={{ top: `${at(nowMinutes)}%` }}
                >
                  <span className="bg-brand-accent absolute -top-[3px] -left-[4px] size-2 rounded-full" />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Phones: one line per day. */}
      <ol className="space-y-1.5 sm:hidden">
        {days.map((d) => (
          <li
            key={d.key}
            aria-current={d.isToday ? "date" : undefined}
            className={cn(
              "rounded-tile flex items-start gap-3 px-3 py-2.5",
              d.isToday ? "bg-brand-accent text-brand-accent-foreground" : "bg-muted/60",
            )}
          >
            <p className="flex w-20 shrink-0 items-baseline gap-1.5 pt-0.5">
              <span
                className={cn("text-[13px] font-medium", !d.isToday && "text-muted-foreground")}
              >
                {d.isToday ? "Today" : d.weekday}
              </span>
              <span className="numeral text-[20px]">{d.date}</span>
            </p>
            <ul className="min-w-0 flex-1 space-y-1.5 self-center">
              {d.events.length === 0 && (
                <li
                  className={cn("text-[12px]", d.isToday ? "opacity-75" : "text-muted-foreground")}
                >
                  Free
                </li>
              )}
              {d.events.map((e) => (
                <li key={e.id}>
                  <Link
                    href={href(e.id)}
                    style={{ ...kindVars(e.kind), color: KIND_INK }}
                    className="flex items-center justify-between gap-2 rounded-[9px] bg-(--kind) px-2.5 py-1.5 text-[12.5px]"
                  >
                    <span className="truncate font-semibold">{e.title}</span>
                    <span className="shrink-0 opacity-80">{e.time}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
        <span className="text-foreground font-semibold">
          {total === 0 ? "Nothing on this week" : `${total} ${total === 1 ? "event" : "events"}`}
        </span>
        {kinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5" style={kindVars(k)}>
            <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-(--kind)" />
            {KIND_META[k].label}
          </span>
        ))}
      </div>
    </div>
  );
}
