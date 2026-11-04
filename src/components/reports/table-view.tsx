import { ChevronRight } from "@/components/icons";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The table twin of a chart: every plotted value is readable without the
 * chart or its tooltip. Collapsed by default (a native <details>, no JS),
 * and in the one table style when open: a rounded header band that sticks,
 * hairlines between rows only, numbers right-aligned and tabular.
 */
export function TableView({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: { key: string; label: string; numeric?: boolean }[];
  rows: { key: string; cells: Record<string, ReactNode> }[];
}) {
  if (rows.length === 0) return null;
  return (
    <details className="group text-sm">
      <summary className="text-muted-foreground hover:text-foreground focus-glow inline-flex w-fit cursor-pointer list-none items-center gap-1 rounded-full text-[13px] font-medium select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-4 transition-transform duration-200 group-open:rotate-90"
          aria-hidden="true"
        />
        Show as table
      </summary>
      <div className="mt-2.5 max-h-72 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-left text-[13px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "text-muted-foreground first:rounded-l-field last:rounded-r-field sticky top-0 h-9 bg-[color-mix(in_oklab,var(--muted)_70%,var(--card))] px-3 font-semibold whitespace-nowrap",
                    c.numeric && "text-right",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="group/row">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "border-border/70 h-10 border-b px-3 group-last/row:border-b-0",
                      c.numeric && "text-right tabular-nums",
                    )}
                  >
                    {r.cells[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
