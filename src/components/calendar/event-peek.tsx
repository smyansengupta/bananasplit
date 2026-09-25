"use client";

import { ArrowRight, CalendarClock, CalendarX2, Globe, Lock, MapPin, Pencil, Ticket } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { type CalendarItem, timeRange } from "./item";
import { KIND_META, RSVP_META, SYNC_META, VISIBILITY_META } from "./kinds";
import { longDate } from "./month-grid";

/**
 * Event detail, anchored to the chip you opened it from.
 *
 * This is the club website's popover, with one deliberate difference: it
 * opens on CLICK and on keyboard activation, never on hover. On the website
 * the calendar is read-only, so a hover peek costs nothing; here an admin
 * drags chips between days, and a card that appears under the pointer
 * mid-drag is in the way. One interaction that touch, pointer and keyboard
 * all share is also simply less to explain.
 *
 * It carries the answer to "what is this" and the two things you would do
 * next (open it, edit it). Everything heavier than that — attendees, notes,
 * the sync error, delete — stays on the event's own page.
 */

export interface PeekAnchor {
  id: string;
  x: number;
  y: number;
  place: "above" | "below";
}

/** Enough room above the chip for the card plus its gap; below this it flips under. */
const CLEARANCE = 260;
const WIDTH = 304;

/** The anchor position for a chip, measured against the positioned wrapper. */
export function anchorFor(chip: HTMLElement, wrapper: HTMLElement, id: string): PeekAnchor {
  const w = wrapper.getBoundingClientRect();
  const c = chip.getBoundingClientRect();
  const above = c.top - w.top > CLEARANCE;
  const half = Math.min(WIDTH, w.width) / 2;
  const rawX = c.left - w.left + c.width / 2;
  return {
    id,
    x: Math.min(Math.max(rawX, half), Math.max(w.width - half, half)),
    y: above ? c.top - w.top - 8 : c.bottom - w.top + 8,
    place: above ? "above" : "below",
  };
}

export function EventPeek({
  item,
  anchor,
  orgSlug,
  canManage,
  showSync,
  onClose,
  onEdit,
}: {
  item: CalendarItem;
  anchor: PeekAnchor;
  orgSlug: string;
  canManage: boolean;
  showSync: boolean;
  onClose: () => void;
  onEdit: (item: CalendarItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const kind = KIND_META[item.kind];
  const visibility = VISIBILITY_META[item.visibility];
  const VisIcon = item.visibility === "PUBLIC" ? Globe : Lock;

  // Opening is always deliberate here (a click or Enter), so moving focus
  // into the card is the right thing: it puts Escape, the links and the
  // edit button one tab away.
  useEffect(() => {
    ref.current?.focus();
  }, [anchor.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onPointerDown(event: PointerEvent) {
      const node = ref.current;
      if (!node) return;
      const target = event.target as Node | null;
      if (target && !node.contains(target) && !(target as HTMLElement).closest?.("[aria-expanded]")) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  const dayKey = item.allDay ? item.start : localKey(new Date(item.start));

  return (
    <div
      id="cal-peek"
      className="cal-pop"
      style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
      data-place={anchor.place}
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label={`${item.title}, detail`}
    >
      <p className="cal-pop__kind">
        <span aria-hidden className="cal-chip__dot" style={{ ["--kind" as string]: `var(${kind.token})` }} />
        {kind.label}
      </p>

      <h3 className="mt-1.5 text-base leading-snug font-semibold break-words">{item.title}</h3>

      <p className="mt-1 text-sm font-medium">
        {longDate(dayKey)}
        {!item.allDay && ` · ${timeRange(item)}`}
        {item.allDay && " · All day"}
      </p>

      {item.location && (
        <p className="text-muted-foreground mt-1 flex items-start gap-1.5 text-sm">
          <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{item.location}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant={item.visibility === "PUBLIC" ? "secondary" : "outline"} title={visibility.hint}>
          <VisIcon aria-hidden className="size-3" />
          {visibility.label}
        </Badge>
        {item.rsvp && (
          <Badge variant={item.rsvp === "YES" ? "default" : item.rsvp === "NO" ? "outline" : "secondary"}>
            <Ticket aria-hidden className="size-3" />
            {RSVP_META[item.rsvp].label}
          </Badge>
        )}
        {showSync && item.syncState === "PENDING" && (
          <Badge variant="outline" title={SYNC_META.PENDING.hint}>
            <CalendarClock aria-hidden className="size-3" />
            {SYNC_META.PENDING.label}
          </Badge>
        )}
        {showSync && item.syncState === "FAILED" && (
          <Badge variant="destructive" title={SYNC_META.FAILED.hint}>
            <CalendarX2 aria-hidden className="size-3" />
            {SYNC_META.FAILED.label}
          </Badge>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" className="flex-1" asChild>
          <Link href={`/app/${orgSlug}/calendar/${item.id}`}>
            Open
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </Button>
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => onEdit(item)}>
            <Pencil aria-hidden className="size-3.5" />
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

function localKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
