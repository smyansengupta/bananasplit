import type { ReactNode } from "react";

import { WEEKDAYS, type HeatGrid } from "@/lib/crm/crm-reports";
import type { ChoiceColor } from "@/lib/databases/fields";
import { cn } from "@/lib/utils";

/**
 * The small pieces the CRM's report cards are drawn with (no hooks, so the
 * server page renders them): a big figure with its comparison, a progress
 * bar, columns by month, a stacked bar with its legend and the send-time
 * grid. Colours are the chart palette.
 */

export const SERIES = ["var(--chart-1)", "var(--chart-4)", "var(--chart-3)", "var(--tag-plum)", "var(--chart-5)", "var(--chart-2)"];

/** A choice's colour (a deal type) as a fill. */
export function choiceTone(color: ChoiceColor): string {
  const tones: Record<ChoiceColor, string> = {
    blue: "var(--chart-1)",
    yellow: "var(--chart-4)",
    green: "var(--chart-3)",
    purple: "var(--tag-plum)",
    orange: "var(--chart-2)",
    pink: "var(--chart-5)",
    red: "var(--destructive)",
    teal: "var(--tag-teal)",
    brown: "var(--tag-rust)",
    gray: "var(--muted-foreground)",
  };
  return tones[color];
}

export function Figure({ value, detail }: { value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="numeral text-[34px] leading-none">{value}</span>
      {detail ? <span className="text-muted-foreground text-sm">{detail}</span> : null}
    </div>
  );
}

export function Progress({ share, label }: { share: number; label: string }) {
  return (
    <div className="bg-muted h-2.5 overflow-hidden rounded-full" role="img" aria-label={label}>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, Math.round(share * 100)))}%`, background: "var(--chart-3)" }}
      />
    </div>
  );
}

/** Columns, one per month, each with its value on top. */
export function MonthColumns({
  items,
  label,
  color = "var(--chart-1)",
}: {
  items: { key: string; label: string; value: number; display: string }[];
  label: string;
  color?: string;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <ul aria-label={label} className="flex h-40 items-end gap-2">
      {items.map((i) => (
        <li key={i.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
          <span className="text-muted-foreground text-xs font-semibold tabular-nums">{i.display}</span>
          <div
            aria-hidden="true"
            className="w-full max-w-11 rounded-t-xl rounded-b-sm"
            style={{
              height: `${max > 0 ? Math.max(4, Math.round((i.value / max) * 106)) : 4}px`,
              background: i.value > 0 ? color : "var(--muted)",
            }}
          />
          <span className="text-muted-foreground text-xs">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** One bar split by share, and its legend under it. */
export function StackBar({
  items,
  label,
}: {
  items: { key: string; label: string; value: number; display: string; color: string }[];
  label: string;
}) {
  const total = items.reduce((n, i) => n + i.value, 0);
  return (
    <div className="space-y-3">
      <div className="bg-muted flex h-3.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={label}>
        {total > 0 &&
          items
            .filter((i) => i.value > 0)
            .map((i) => (
              <div key={i.key} style={{ width: `${((i.value / total) * 100).toFixed(1)}%`, background: i.color }} />
            ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: i.color }} />
            {i.label} <b className="tabular-nums">{i.display}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Reply rate by weekday and part of the day: darker is better. */
export function HeatTable({ grid }: { grid: HeatGrid }) {
  return (
    <table className="w-full border-separate border-spacing-1 text-center text-xs">
      <thead>
        <tr>
          <th />
          {WEEKDAYS.map((d) => (
            <th key={d} className="text-muted-foreground font-semibold">
              {d}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.rows.map((r) => (
          <tr key={r.part}>
            <th className="text-muted-foreground pe-1 text-start font-medium">{r.part}</th>
            {r.cells.map((c) => {
              const share = c.rate !== null && grid.max > 0 ? c.rate / grid.max : 0;
              return (
                <td
                  key={c.day}
                  title={c.rate !== null ? `${r.part}, ${c.day}: ${Math.round(c.rate * 100)}% replied of ${c.sent}` : `${c.sent} sent, too few to read`}
                  className={cn("h-8 rounded-full font-semibold tabular-nums", share > 0.6 ? "text-background" : "text-foreground")}
                  style={{
                    background:
                      c.rate !== null
                        ? `color-mix(in oklab, var(--foreground) ${Math.round(share * 100)}%, var(--card))`
                        : "var(--muted)",
                  }}
                >
                  {c.rate !== null ? `${Math.round(c.rate * 100)}%` : ""}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
