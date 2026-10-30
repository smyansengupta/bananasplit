"use client";

import Link from "next/link";

import { KIND_INK } from "@/components/calendar/kinds";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

export interface TypeFilterChip {
  key: string;
  label: string;
  /** The meeting type's colour ("#rrggbb"), or null for the untyped. */
  color: string | null;
  count: number;
  href: string;
  on: boolean;
}

/**
 * The Meetings filter row: one chip per meeting type on the page, with its
 * count, and a switch between date order and grouped by type. A chosen
 * type's chip fills with that type's own colour, the same colour as its
 * cards' date tiles. Everything is a link (?type=, ?sort=), so a filtered
 * view can be shared.
 */
export function MeetingsTypeFilter({
  all,
  chips,
  byType,
  dateHref,
  typeHref,
}: {
  all: { count: number; href: string; on: boolean };
  chips: TypeFilterChip[];
  byType: boolean;
  dateHref: string;
  typeHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Show meetings of one type" className="flex flex-wrap items-center gap-2">
        <Link
          href={all.href}
          scroll={false}
          aria-current={all.on ? "true" : undefined}
          className={chipClass(all.on)}
        >
          All
          <span className="tabular-nums opacity-60">{all.count}</span>
        </Link>
        {chips.map((k) => (
          <Link
            key={k.key}
            href={k.href}
            scroll={false}
            aria-current={k.on ? "true" : undefined}
            style={{
              ["--kind" as string]: k.color ?? "var(--muted-foreground)",
              ...(k.on ? { color: KIND_INK } : {}),
            }}
            className={cn(
              chipClass(false),
              k.on && "border-transparent bg-(--kind) hover:bg-(--kind)",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("size-2 shrink-0 rounded-full", k.on ? "bg-current" : "bg-(--kind)")}
            />
            {k.label}
            <span className="tabular-nums opacity-60">{k.count}</span>
          </Link>
        ))}
      </nav>
      <Segmented
        label="Order"
        value={byType ? "type" : "date"}
        options={[
          { value: "date", label: "By date", href: dateHref },
          { value: "type", label: "By type", href: typeHref },
        ]}
      />
    </div>
  );
}
