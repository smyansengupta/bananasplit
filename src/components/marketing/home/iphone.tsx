import { CalendarDays, ChevronLeft, SquareCheckBig, Video } from "@/components/icons";
import type { ReactNode } from "react";

import { CoreMark } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

import { IMESSAGE, IMESSAGE_DARK, IMESSAGE_LIGHT } from "../palette";

/**
 * An iPhone in light mode with an iMessage thread to Bananasplit, drawn in
 * code (it stays sharp at any size): the black titanium frame and Dynamic
 * Island, the thread's header, the bubbles, and small cards for what each
 * text did. Decoration: the caller labels it.
 */

export type Message =
  { from: "you"; text: string } | { from: "bananasplit"; text: string; card?: ReactNode };

/** A small card inside a reply: what changed in the workspace. */
export function ReplyCard({
  icon,
  title,
  meta,
}: {
  icon: "calendar" | "task" | "call";
  title: string;
  meta: string;
}) {
  const Icon = icon === "calendar" ? CalendarDays : icon === "task" ? SquareCheckBig : Video;
  return (
    // Tinted from the bubble's own text colour, so it reads in any bubble.
    <span className="mt-1.5 flex items-center gap-2 rounded-[12px] bg-[color-mix(in_oklab,currentColor_8%,transparent)] px-2.5 py-2">
      <span className="grid size-7 flex-none place-items-center rounded-[8px] bg-[color-mix(in_oklab,currentColor_12%,transparent)]">
        <Icon className="size-3.5" />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[11.5px] font-semibold">{title}</span>
        <span className="truncate text-[10.5px] opacity-60">{meta}</span>
      </span>
    </span>
  );
}

/** The seconds between one bubble's arrival and the next. */
const BUBBLE_GAP = 0.7;

/**
 * The bubbles alone. With `arriveAt` (seconds), they pop in one by one from
 * then on (animate-home-pop, brand.css), the way a thread fills.
 */
export function Thread({
  messages,
  size = "md",
  arriveAt,
  className,
}: {
  messages: readonly Message[];
  size?: "sm" | "md";
  arriveAt?: number;
  className?: string;
}) {
  const text = size === "sm" ? "text-[12.5px]" : "text-[15px]";
  return (
    <ol className={cn("m-0 flex list-none flex-col gap-1.5 p-0", className)}>
      {messages.map((m, i) => (
        <li
          key={i}
          className={cn(
            "max-w-[82%] rounded-[18px] px-3 py-[7px] leading-[1.3]",
            text,
            m.from === "you"
              ? "origin-bottom-right self-end rounded-br-[5px]"
              : "origin-bottom-left self-start rounded-bl-[5px]",
            i > 0 && messages[i - 1]!.from !== m.from && "mt-1.5",
            arriveAt !== undefined && "animate-home-pop",
          )}
          style={{
            ...(m.from === "you"
              ? { backgroundColor: IMESSAGE.blue, color: IMESSAGE.white }
              : { backgroundColor: IMESSAGE_LIGHT.received, color: IMESSAGE_LIGHT.ink }),
            ...(arriveAt !== undefined ? { animationDelay: `${arriveAt + i * BUBBLE_GAP}s` } : {}),
          }}
        >
          {m.text}
          {m.from === "bananasplit" && m.card}
        </li>
      ))}
    </ol>
  );
}

export function IPhone({
  messages,
  arriveAt,
  fromTop = false,
  className,
}: {
  messages: readonly Message[];
  /** When the thread starts filling in (seconds), as Thread's. */
  arriveAt?: number;
  /** Messages from just under the header down, for a phone whose bottom is cut off. */
  fromTop?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative aspect-[9/19.2] rounded-[54px] p-[10px]", className)}
      style={{
        backgroundColor: IMESSAGE_DARK.frame,
        boxShadow: `inset 0 0 0 1.5px ${IMESSAGE_DARK.frameEdge}, ${IMESSAGE_DARK.shadow}`,
      }}
    >
      <div
        className="relative flex h-full flex-col overflow-hidden rounded-[44px]"
        style={{ backgroundColor: IMESSAGE_LIGHT.screen, color: IMESSAGE_LIGHT.ink }}
      >
        {/* Status bar and the Dynamic Island. */}
        <div className="relative flex h-11 flex-none items-center justify-between px-7 pt-1 text-[13px] font-semibold">
          <span>9:41</span>
          <span className="absolute top-2.5 left-1/2 h-[26px] w-[92px] -translate-x-1/2 rounded-full bg-black" />
          <span className="flex items-center gap-1">
            <span className="flex items-end gap-[2px]">
              {[4, 6, 8, 10].map((h) => (
                <span key={h} className="w-[3px] rounded-[1px] bg-current" style={{ height: h }} />
              ))}
            </span>
            <span className="ml-1 h-[11px] w-[22px] rounded-[3px] border border-current/50 p-[1.5px]">
              <span className="block h-full w-[70%] rounded-[1.5px] bg-current" />
            </span>
          </span>
        </div>

        {/* The thread's header: back, the contact, its name. */}
        <div
          className="flex flex-none flex-col items-center gap-1 border-b px-4 pt-1 pb-2.5"
          style={{ backgroundColor: IMESSAGE_LIGHT.bar, borderColor: IMESSAGE_LIGHT.hairline }}
        >
          <span className="relative flex w-full justify-center">
            <ChevronLeft
              className="absolute top-1/2 left-0 size-6 -translate-y-1/2"
              style={{ color: IMESSAGE.blue }}
            />
            <span
              className="grid size-11 place-items-center rounded-full"
              style={{ backgroundColor: IMESSAGE_LIGHT.received }}
            >
              <CoreMark size={30} />
            </span>
          </span>
          <span className="text-[11.5px] font-medium">Bananasplit</span>
        </div>

        {/* Newest at the bottom (the oldest clip off the top, as a thread scrolls), or from the top. */}
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-3 pb-2",
            fromTop ? "justify-start pt-2" : "justify-end",
          )}
        >
          <span className="text-center text-[10.5px]" style={{ color: IMESSAGE_DARK.meta }}>
            Today 9:41 AM
          </span>
          <Thread messages={messages} size="sm" arriveAt={arriveAt} />
          <span className="self-end pr-1 text-[10px]" style={{ color: IMESSAGE_DARK.meta }}>
            Delivered
          </span>
        </div>

        {/* The compose bar. */}
        <div className="flex flex-none items-center gap-2 px-3 pt-1 pb-6">
          <span
            className="grid size-8 flex-none place-items-center rounded-full text-[18px] leading-none"
            style={{ backgroundColor: IMESSAGE_LIGHT.received, color: IMESSAGE_DARK.meta }}
          >
            +
          </span>
          <span
            className="flex h-8 flex-1 items-center rounded-full border px-3 text-[12px]"
            style={{ borderColor: IMESSAGE_LIGHT.field, color: IMESSAGE_DARK.meta }}
          >
            iMessage
          </span>
        </div>
        <span className="absolute bottom-2 left-1/2 h-[5px] w-[120px] -translate-x-1/2 rounded-full bg-black/80" />
      </div>
      {/* The side buttons. */}
      <span
        className="absolute top-[22%] -left-[3px] h-14 w-[3px] rounded-l-[2px]"
        style={{ backgroundColor: IMESSAGE_DARK.frameEdge }}
      />
      <span
        className="absolute top-[30%] -right-[3px] h-20 w-[3px] rounded-r-[2px]"
        style={{ backgroundColor: IMESSAGE_DARK.frameEdge }}
      />
    </div>
  );
}
