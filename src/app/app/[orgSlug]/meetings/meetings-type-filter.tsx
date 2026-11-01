"use client";

import Link from "next/link";

import { KIND_INK } from "@/components/calendar/kinds";
import { chipClass, Segmented } from "@/components/ui/segmented";
import { FiltersMenu } from "@/components/ui/toolbar-chips";
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
 * Meetings' Filters chip, on the bar beside the views: the order (by date
 * or grouped by type), then one chip per meeting type on the page, with its
 * count. A chosen type's chip fills with that type's own colour, the same
 * colour as its cards' date tiles. Everything is a link (?type=, ?sort=), so
 * a filtered view can be shared.
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
    <FiltersMenu
      count={all.on ? 0 : 1}
      items={[
        {
          name: "Order",
          node: (
            <Segmented
              label="Order"
              value={byType ? "type" : "date"}
              options={[
                { value: "date", label: "By date", href: dateHref },
                { value: "type", label: "By type", href: typeHref },
              ]}
            />
          ),
        },
        {
          name: "Type",
          node: (
            <nav aria-label="Show meetings of one type" className="flex flex-wrap gap-1.5">
              <Link
                href={all.href}
                scroll={false}
                aria-current={all.on ? "true" : undefined}
                className={cn(chipClass(all.on), "h-8 px-3 text-[13px]")}
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
                    "h-8 px-3 text-[13px]",
                    k.on && "border-transparent bg-(--kind) hover:bg-(--kind)",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      k.on ? "bg-current" : "bg-(--kind)",
                    )}
                  />
                  {k.label}
                  <span className="tabular-nums opacity-60">{k.count}</span>
                </Link>
              ))}
            </nav>
          ),
        },
      ]}
    />
  );
}
