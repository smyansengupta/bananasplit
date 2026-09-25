"use client";

import type { ReactNode } from "react";

/**
 * Shared chart chrome for the report charts (recharts), following the
 * dataviz method: colors come ONLY from the theme's chart tokens
 * (--chart-1..5, assigned in fixed order, never cycled), so a theme change
 * restyles every chart; axes and gridlines are recessive solid hairlines;
 * text wears text tokens, never a series color; the tooltip leads with the
 * value and keys each series with a short line in its color.
 */

export const SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export const AXIS_TICK = { fill: "var(--muted-foreground)", fontSize: 12 };

export const axisProps = {
  tick: AXIS_TICK,
  axisLine: false,
  tickLine: false,
} as const;

export const gridProps = {
  stroke: "var(--border)",
  strokeWidth: 1,
  vertical: false,
} as const;

/** The 2px surface gap between touching fills and the ring around markers. */
export const SURFACE = "var(--card)";

export interface LegendEntry {
  label: string;
  color: string;
  shape?: "rect" | "line";
}

/** A legend row above the plot (always present for two or more series). */
export function ChartLegend({ entries }: { entries: LegendEntry[] }) {
  return (
    <ul
      className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs"
      aria-label="Legend"
    >
      {entries.map((e) => (
        <li key={e.label} className="flex items-center gap-1.5">
          {e.shape === "line" ? (
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-3 rounded-full"
              style={{ background: e.color }}
            />
          ) : (
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-[3px]"
              style={{ background: e.color }}
            />
          )}
          {e.label}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipRow {
  label: string;
  value: ReactNode;
  color?: string;
}

/** Tooltip body: a heading, then one row per series (value first). */
export function TooltipCard({
  heading,
  sub,
  rows,
}: {
  heading: ReactNode;
  sub?: ReactNode;
  rows: TooltipRow[];
}) {
  return (
    <div className="bg-popover text-popover-foreground ring-foreground/10 max-w-64 rounded-lg px-3 py-2 text-xs shadow-md ring-1">
      <div className="font-medium">{heading}</div>
      {sub ? <div className="text-muted-foreground">{sub}</div> : null}
      <ul className="mt-1.5 flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            {r.color ? (
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ background: r.color }}
              />
            ) : null}
            <span className="text-sm font-semibold tabular-nums">{r.value}</span>
            <span className="text-muted-foreground">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Placeholder with the chart's exact footprint, so lazy loading never shifts the layout. */
export function ChartSkeleton({ height }: { height: number }) {
  return (
    <div
      className="bg-muted/50 w-full animate-pulse rounded-md"
      style={{ height }}
      aria-hidden="true"
    />
  );
}
