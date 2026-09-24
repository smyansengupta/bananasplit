import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface BarListItem {
  key: string;
  label: ReactNode;
  /** Bar length; null draws no bar (a suppressed or missing value). */
  value: number | null;
  /** The value text at the bar's end ("42", "<3"). */
  display: ReactNode;
  /** A secondary line under the label. */
  detail?: ReactNode;
  href?: string | null;
}

/**
 * Horizontal bars in plain HTML: one series, so every bar wears the slot-1
 * chart token (--chart-1), grows from one baseline, is at most 12px thick
 * with a 4px rounded end, and has its value as text beside it (the value
 * never relies on the bar). Labels and values use text tokens.
 */
export function BarList({
  items,
  max,
  label,
  className,
}: {
  items: BarListItem[];
  /** The value of a full-width bar (defaults to the largest value). */
  max?: number;
  /** Accessible name of the list. */
  label: string;
  className?: string;
}) {
  const top = max ?? Math.max(0, ...items.map((i) => i.value ?? 0));
  return (
    <ul aria-label={label} className={cn("flex flex-col gap-2.5", className)}>
      {items.map((item) => {
        const width = item.value !== null && top > 0 ? Math.max(0, Math.min(1, item.value / top)) : 0;
        const row = (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1">
            <div className="min-w-0">
              <div className="truncate text-sm">{item.label}</div>
              {item.detail ? <div className="text-muted-foreground truncate text-xs">{item.detail}</div> : null}
            </div>
            <div className="text-sm font-medium tabular-nums">{item.display}</div>
            <div className="bg-muted col-span-2 h-3 overflow-hidden rounded-r-[4px]" aria-hidden="true">
              {width > 0 ? (
                <div
                  className="h-full rounded-r-[4px]"
                  style={{ width: `${(width * 100).toFixed(2)}%`, background: "var(--chart-1)" }}
                />
              ) : null}
            </div>
          </div>
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <Link
                href={item.href}
                className="hover:bg-muted/60 focus-visible:ring-ring/50 -mx-2 block rounded-md px-2 py-1 outline-none focus-visible:ring-3"
              >
                {row}
              </Link>
            ) : (
              <div className="py-1">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
