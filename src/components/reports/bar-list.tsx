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
 * Horizontal bars in plain HTML (the chart kit's ranked list): one series,
 * so every bar wears slot 1 (--chart-1), grows from one baseline on a soft
 * track, with rounded ends, and has its value as text beside it (the value
 * never relies on the bar). Rows become a soft tile on hover when they link.
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
    <ul aria-label={label} className={cn("flex flex-col gap-1.5", className)}>
      {items.map((item) => {
        const width =
          item.value !== null && top > 0 ? Math.max(0, Math.min(1, item.value / top)) : 0;
        const row = (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-3 gap-y-1.5">
            <div className="min-w-0">
              <div className="text-sm font-medium break-words">{item.label}</div>
              {item.detail ? (
                <div className="text-muted-foreground text-xs">{item.detail}</div>
              ) : null}
            </div>
            <div className="text-sm font-semibold tabular-nums">{item.display}</div>
            <div
              className="bg-muted col-span-2 h-2.5 overflow-hidden rounded-full"
              aria-hidden="true"
            >
              {width > 0 ? (
                <div
                  className="h-full min-w-2.5 rounded-full"
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
                className="hover:bg-muted/60 focus-glow rounded-field -mx-2.5 block px-2.5 py-2 transition-colors outline-none"
              >
                {row}
              </Link>
            ) : (
              <div className="py-2">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
