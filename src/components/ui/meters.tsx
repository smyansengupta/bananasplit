import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The chart kit's meters (Moonstone, section 8 of the redesign guide). All
 * colours are theme tokens; "not yet" is a hatch, never a sixth colour.
 */

/**
 * Progress toward a fixed amount, one tick per real unit (a member, a seat,
 * $125). Filled ticks take `color` (a chart slot by default).
 */
export function TickMeter({
  total,
  filled,
  label,
  color = "var(--chart-2)",
  height = 26,
  className,
}: {
  total: number;
  filled: number;
  /** What the meter says, for screen readers: "8 of 14 voted". */
  label: string;
  color?: string;
  height?: number;
  className?: string;
}) {
  const ticks = Math.max(1, Math.min(total, 60));
  const on = Math.round((Math.min(filled, total) / Math.max(total, 1)) * ticks);
  return (
    <div
      role="img"
      aria-label={label}
      style={{ height, "--tick": color } as CSSProperties}
      className={cn("flex gap-[3px]", className)}
    >
      {Array.from({ length: ticks }, (_, i) => (
        <i
          key={i}
          className={cn(
            "min-w-0.5 flex-1 rounded-[3px]",
            i < on ? "bg-(--tick)" : "bg-muted-strong",
          )}
        />
      ))}
    </div>
  );
}

const GAUGE_TONES = {
  glow: "stroke-glow drop-shadow-[0_0_5px_color-mix(in_oklab,var(--glow)_55%,transparent)]",
  ink: "stroke-foreground",
  success: "stroke-success",
  attention: "stroke-(--attention)",
} as const;

/** Where `mark` (0-100) falls on the arc, `r` from the middle. */
function onArc(mark: number, r: number): [number, number] {
  const angle = ((135 + 2.7 * mark) * Math.PI) / 180;
  return [60 + r * Math.cos(angle), 60 + r * Math.sin(angle)];
}

/**
 * One number against a goal: a 270° arc, the value in the middle. `mark` is a
 * small notch inside the arc for where it should be by now; `children` take
 * the middle's place (a small gauge's number, a check).
 */
export function Gauge({
  value,
  caption = "full",
  size = 132,
  tone = "glow",
  mark,
  stroke = 10,
  label,
  className,
  children,
}: {
  /** 0-100. */
  value: number;
  caption?: ReactNode;
  size?: number;
  tone?: keyof typeof GAUGE_TONES;
  /** 0-100. */
  mark?: number;
  /** The arc's weight, on a 120 wide gauge. */
  stroke?: number;
  /** For screen readers, in place of "48 percent". */
  label?: string;
  className?: string;
  children?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const notch = mark === undefined ? null : Math.max(0, Math.min(100, mark));
  const inner = notch === null ? null : onArc(notch, 52 - stroke / 2 - 2);
  const tip = notch === null ? null : onArc(notch, 52 - stroke / 2 - 9);
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 120 120"
        role="img"
        aria-label={label ?? `${pct} percent`}
        className="size-full"
      >
        <path
          d="M23.2 96.8 A52 52 0 1 1 96.8 96.8"
          pathLength={100}
          className="fill-none stroke-current opacity-20"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        {pct > 0 && (
          <path
            d="M23.2 96.8 A52 52 0 1 1 96.8 96.8"
            pathLength={100}
            className={cn("fill-none", GAUGE_TONES[tone])}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${pct} 100`}
          />
        )}
        {inner && tip && (
          <line
            x1={inner[0]}
            y1={inner[1]}
            x2={tip[0]}
            y2={tip[1]}
            className="stroke-muted-foreground"
            strokeWidth={4}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        {children ?? (
          <>
            <b className="numeral text-[32px]">{pct}%</b>
            <span className="text-[12px] font-medium opacity-80">{caption}</span>
          </>
        )}
      </div>
    </div>
  );
}

export interface DayBar {
  key: string;
  /** Under the bar: "M". */
  label: string;
  /** On hover: "Tue, Nov 3: 4 done, 1 held back". */
  title: string;
  value: number;
  /** A second, quieter part stacked on top, in the attention colour. */
  extra?: number;
  /** Today: its label is bold. */
  current?: boolean;
}

/**
 * A few days as thin bars from one baseline, tallest at full height, with
 * the day under each. A day with nothing keeps a stub, so a quiet day reads
 * as a day. `extraLabel` names the second part in a legend when any day has it.
 */
export function DayBars({
  days,
  label,
  valueLabel,
  extraLabel,
  height = 56,
  className,
}: {
  days: readonly DayBar[];
  /** For screen readers: "14 done this week, most on Tuesday". */
  label: string;
  valueLabel?: string;
  extraLabel?: string;
  height?: number;
  className?: string;
}) {
  const max = Math.max(1, ...days.map((d) => d.value + (d.extra ?? 0)));
  const hasExtra = days.some((d) => (d.extra ?? 0) > 0);
  return (
    <div className={className}>
      <div role="img" aria-label={label} className="flex items-end gap-1.5">
        {days.map((d) => {
          const extra = d.extra ?? 0;
          return (
            <div key={d.key} title={d.title} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
              <div
                className="flex w-full max-w-7 flex-col justify-end gap-0.5"
                style={{ height }}
              >
                {extra > 0 && (
                  <i
                    className="block min-h-1 rounded-t-[4px] bg-(--attention)"
                    style={{ height: `${(extra / max) * 100}%` }}
                  />
                )}
                {d.value > 0 && (
                  <i
                    className={cn(
                      "bg-foreground block min-h-1",
                      extra === 0 && "rounded-t-[4px]",
                    )}
                    style={{ height: `${(d.value / max) * 100}%` }}
                  />
                )}
                {d.value === 0 && extra === 0 && (
                  <i className="bg-muted-strong block h-[3px] rounded-t-[2px]" />
                )}
              </div>
              <span
                className={cn(
                  "text-[11px] leading-none",
                  d.current ? "text-foreground font-semibold" : "text-muted-foreground",
                )}
              >
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
      {hasExtra && valueLabel && extraLabel && (
        <div className="text-muted-foreground mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden="true" className="bg-foreground size-2.5 rounded-[3px]" />
            {valueLabel}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden="true" className="size-2.5 rounded-[3px] bg-(--attention)" />
            {extraLabel}
          </span>
        </div>
      )}
    </div>
  );
}

export interface MixSegment {
  label: string;
  value: number;
  /** A theme token ("var(--chart-2)"); omit with `hatch` for "not yet". */
  color?: string;
  hatch?: boolean;
}

/** How a whole splits into parts, to scale, in a fixed order, with a legend. */
export function MixBar({
  segments,
  label,
  height = 44,
  legend = true,
  className,
}: {
  segments: readonly MixSegment[];
  /** For screen readers: "12 not started, 9 in progress...". */
  label: string;
  height?: number;
  legend?: boolean;
  className?: string;
}) {
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div className={className}>
      <div role="img" aria-label={label} className="flex gap-1.5" style={{ height }}>
        {visible.map((s) => (
          <i
            key={s.label}
            style={{ flexGrow: s.value, background: s.hatch ? undefined : s.color }}
            className={cn(
              "min-w-1.5 basis-0 rounded-[14px]",
              s.hatch && "bg-muted hatch",
              height <= 20 && "rounded-full",
            )}
          />
        ))}
      </div>
      {legend && (
        <div className="mt-3 flex flex-wrap gap-x-4.5 gap-y-2 text-[13px]">
          {segments.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                style={{ background: s.hatch ? undefined : s.color }}
                className={cn("size-2.5 rounded-[3px]", s.hatch && "bg-muted-strong")}
              />
              {s.label} <b className="font-semibold tabular-nums">{s.value}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
